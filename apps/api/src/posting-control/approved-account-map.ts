import { Prisma } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';

type MapReader = Pick<Prisma.TransactionClient, 'approvedPostingMap' | 'postingGroupAssignment'>;
type LifecycleReader = MapReader & Pick<Prisma.TransactionClient, 'speciesBreedStage'>;

/** Resolve one workbook account map without embedding its GL code in a domain service. */
export async function resolveApprovedMappedAccount(
  client: MapReader,
  params: { companyId: string; application: string; postingGroup?: string; masterType?: string; masterId?: string; postingKey: string; on: Date },
) {
  const on = new Date(Date.UTC(params.on.getUTCFullYear(), params.on.getUTCMonth(), params.on.getUTCDate()));
  let postingGroup = params.postingGroup;
  if (params.masterType || params.masterId) {
    if (!params.masterType || !params.masterId) {
      throw new AccountingRuleViolation('Approved Posting Group — master assignment', 'Both masterType and masterId are required to resolve a master-assigned posting group.', params);
    }
    const assignments = await client.postingGroupAssignment.findMany({
      where: {
        companyId: params.companyId,
        masterType: params.masterType,
        masterId: params.masterId,
        status: 'Active',
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        approvedPostingGroup: {
          companyId: params.companyId,
          application: params.application,
          masterType: params.masterType,
          status: 'Active',
          effectiveFrom: { lte: on },
        },
      },
      include: { approvedPostingGroup: true },
      take: 2,
    });
    if (assignments.length !== 1) {
      throw new AccountingRuleViolation(
        'Approved Posting Group — unique effective assignment',
        `${params.application} / ${params.masterType} ${params.masterId} must have exactly one active posting group on ${on.toISOString().slice(0, 10)}.`,
        { ...params, matches: assignments.length },
      );
    }
    const assigned = assignments[0]!.approvedPostingGroup.postingGroup;
    if (postingGroup && postingGroup !== assigned) {
      throw new AccountingRuleViolation('Approved Posting Group — assignment mismatch', `The ${params.masterType} assignment is ${assigned}, not ${postingGroup}.`, { ...params, assigned });
    }
    postingGroup = assigned;
  }
  if (!postingGroup) {
    throw new AccountingRuleViolation('Approved Posting Group — assignment required', 'Supply either the approved posting group or an assigned master record.', params);
  }
  const rows = await client.approvedPostingMap.findMany({
    where: {
      companyId: params.companyId,
      application: params.application,
      postingGroup,
      postingKey: params.postingKey,
      status: 'Active',
      effectiveFrom: { lte: on },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
    },
    include: { glAccount: true },
    orderBy: { effectiveFrom: 'desc' },
    take: 2,
  });
  const row = rows[0];
  if (rows.length !== 1 || !row?.glAccount) {
    throw new AccountingRuleViolation(
      'Approved Account Map — unique effective resolution',
      `${params.application} / ${postingGroup} / ${params.postingKey} must resolve to exactly one active account on ${on.toISOString().slice(0, 10)}.`,
      { ...params, postingGroup, matches: rows.length },
    );
  }
  const account = row.glAccount;
  if (!account.active || (!account.isPostingAccount && !account.isControlAccount)) {
    throw new AccountingRuleViolation(
      'Approved Account Map — posting account',
      `${row.accountCode} is inactive or not a posting/control account in the chart.`,
      { accountCode: row.accountCode },
    );
  }
  return { glAccountId: account.id, accountNumber: row.accountCode, accountName: account.name, mapKey: row.mapKey };
}

/** Resolve a Lifecycle stage's assigned group and confirm it matches Finance's maturity classification. */
export async function resolveApprovedLifecycleStageAccount(
  client: LifecycleReader,
  params: { companyId: string; speciesKey: string; stageName: string; postingKey?: string; on: Date },
) {
  const speciesKey = params.speciesKey.trim().toLowerCase();
  const application = speciesKey === 'snail' ? 'YifrehSnail' : speciesKey === 'poultry' ? 'YifrehPoultry' : null;
  if (!application) throw new AccountingRuleViolation('Approved Posting Group — lifecycle stage', 'Unsupported biological species: ' + params.speciesKey, params);
  const stages = await client.speciesBreedStage.findMany({
    where: { stageName: params.stageName, speciesBreed: { companyId: params.companyId, speciesKey: { equals: speciesKey, mode: 'insensitive' }, active: true } },
    select: { id: true, maturityClass: true },
  });
  const classes = [...new Set(stages.map((stage) => stage.maturityClass).filter((value): value is string => !!value))];
  if (!stages.length || classes.length !== 1 || stages.some((stage) => !stage.maturityClass) || !['IMMATURE', 'MATURE'].includes(classes[0]!)) {
    throw new AccountingRuleViolation('Approved Posting Group — lifecycle stage classification', 'Finance must assign one consistent IMMATURE or MATURE classification to ' + params.speciesKey + ' stage "' + params.stageName + '".', { ...params, classifications: classes });
  }
  const prefix = speciesKey === 'snail' ? 'SNP' : 'PLP';
  const postingGroup = prefix + '-BA-' + (classes[0] === 'IMMATURE' ? 'IMM' : 'MAT');
  const resolved = await Promise.all(stages.map((stage) => resolveApprovedMappedAccount(client, {
    companyId: params.companyId,
    application,
    masterType: 'Lifecycle stage',
    masterId: stage.id,
    postingGroup,
    postingKey: params.postingKey ?? 'BA_CONTROL',
    on: params.on,
  })));
  const accounts = new Set(resolved.map((row) => row.glAccountId));
  if (accounts.size !== 1) {
    throw new AccountingRuleViolation('Approved Posting Group — lifecycle stage consistency', 'Stage "' + params.stageName + '" resolves to different GL accounts across its breed records.', { ...params, accountNumbers: [...new Set(resolved.map((row) => row.accountNumber))] });
  }
  return { ...resolved[0]!, postingGroup };
}

/** Resolve inventory held by an Item posting-group assignment using the workbook's key for its item class. */
export async function resolveApprovedItemInventoryAccount(
  client: MapReader,
  params: { companyId: string; application: string; itemId: string; isBiologicalFeed: boolean; isManufactured: boolean; on: Date },
) {
  const postingKey = params.isBiologicalFeed
    ? 'FARM_FEED_INVENTORY'
    : params.isManufactured
      ? 'FINISHED_GOODS_INVENTORY'
      : 'INVENTORY_CONTROL';
  return resolveApprovedMappedAccount(client, {
    companyId: params.companyId,
    application: params.application,
    masterType: 'Item',
    masterId: params.itemId,
    postingKey,
    on: params.on,
  });
}
