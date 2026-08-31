import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ALL_ROLES, ALL_SECTIONS } from '@/lib/permissions';
import { getRoleSectionOverrides } from '@/lib/role-sections';
import { RoleSectionMatrix } from '@/components/role-section-matrix';
import type { SessionUser } from '@/lib/session';

export const metadata = { title: 'Role access — BioAssetPro' };

const WRITE_ROLES = ['CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN'];

/**
 * Which sections of the sidebar each role reaches, with the ability to
 * change it without a redeploy (US-897-035).
 *
 * Says plainly what this is not: the sidebar has always been a courtesy —
 * `permissions.ts` documents that itself — and this page changes the same
 * courtesy layer, not the API's own `@Roles(...)` guards. Hiding a section
 * here does not grant or withdraw a single write permission underneath it.
 */
export default async function RoleAccessPage() {
  const [me, overrides] = await Promise.all([
    api<SessionUser>('/auth/me'),
    getRoleSectionOverrides(),
  ]);

  const canEdit = me.roles.some((role) => WRITE_ROLES.includes(role));

  return (
    <>
      <PageHeader
        title="Role access"
        subtitle="Which sections of the sidebar each role can reach"
      />

      <Tabs />

      <div className="stack">
        <div className="notice notice-warning">
          This controls what the sidebar offers, not what the API accepts — hiding a
          section here does not remove a role&apos;s underlying permissions there, and
          showing one does not grant any. It exists so a role can be given back a page
          it lost, or have one it does not need tucked away, without a code change.
        </div>

        <Card title="Sections by role" padded={false}>
          <RoleSectionMatrix
            roles={ALL_ROLES}
            sections={ALL_SECTIONS}
            overrides={overrides}
            canEdit={canEdit}
          />
        </Card>
      </div>
    </>
  );
}
