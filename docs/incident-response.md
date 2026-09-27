# Incident response

What to do when something goes wrong with BioAssetPro in production: an outage, a suspected breach, a compromised account or secret, or wrong or lost data. It meets the handbook's requirement for incident procedures, alongside backup and restore (§54, security and operations).

Keep this short enough to follow under pressure. For restores, it points to [backup-and-recovery.md](backup-and-recovery.md).

## Who does what

The company fills in these names before go-live.

| Role | Responsibility | Name | Contact |
| --- | --- | --- | --- |
| **Incident lead** | Decides severity, runs the response, keeps the log | | |
| **Technical lead** | Render, Neon and the code; containment and recovery | | |
| **Finance Controller** | Judges the effect on the ledger, payroll and payments; approves corrections | | |
| **Data protection lead** | Personal-data breaches: assessment and notification | | |
| **Product Owner** | Tells the farm's users and management | | |

Anyone who notices a problem reports it to the incident lead straight away. Nobody waits until they're sure.

## Severity

| Level | Examples | Start within |
| --- | --- | --- |
| **1: Critical** | Personal or payroll data exposed; a secret leaked; a payment file altered; the ledger unbalanced; the whole app down | 1 hour, any time |
| **2: High** | One account compromised; wrong postings affecting a closed period; a failed deploy that leaves part of the app broken | Same working day |
| **3: Low** | One screen failing; a slow report; a notification not sent | Next working day |

## Where problems show up

- **Health:** `GET /api/health` on the API reports the API and the database separately. The keep-alive workflow calls it on a schedule.
- **Render logs** for the API and web services. At start-up the API warns if `PII_ENCRYPTION_KEY` is not set, and says when it encrypted existing records.
- **The audit trail** (Ledger, then Audit trail): every posting, approval, change, sign-in and look at sensitive numbers, with who, when and from which IP address. It is append-only, so it survives the incident as evidence.
- **Close packs** (Ledger, then Period close, then Check): whether figures in a closed period have changed since the close.
- **The restore check** (`npm run restore:check -w @bioassetpro/database`): whether a database is complete and consistent.

## The steps

1. **Record it.** Open an entry in the incident log below: time noticed, who noticed, what was seen.
2. **Contain it.** Stop further harm first, using the playbooks below. Don't delete anything. Records, logs and the audit trail are the evidence.
3. **Assess it.** What happened, since when, and which companies, users and records are affected? The audit trail answers most of this. Decide whether personal data was exposed (see "Personal-data breach").
4. **Fix it.** Remove the cause: revoke access, roll back a bad deploy, correct the code.
5. **Recover.** Restore service and data. Wrong postings are corrected by reversal and re-posting, never by editing or deleting; the database refuses both. Lost data is restored from Neon.
6. **Tell people.** Users, management, the client and, where the law requires, the regulator.
7. **Review it.** Within five working days, write down the cause, what worked, what didn't, and the actions that stop it happening again, each with an owner.

## Playbooks

### A user account is compromised, or someone leaves on bad terms

1. An administrator deactivates the account (Staff, then the person, then Deactivate). It takes effect on the user's next request, because every request re-checks the account. Their history stays.
2. Review that user's recent actions in the audit trail, filtered by user, and any documents they approved or posted.
3. Reverse anything they did improperly, with the Finance Controller's approval.

### The JWT secret leaked (anyone could forge a sign-in)

1. In Render, set a new `JWT_SECRET` on the API service and redeploy. Generate it with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   ```
2. Every existing sign-in stops working at once, and everyone signs in again. That is intended.
3. Review the audit trail from the likely time of the leak.

### The database password or URL leaked

1. Reset the database role's password in the Neon console.
2. Update `DATABASE_URL` on the Render API service and redeploy.
3. Check Neon's connection history for unknown sources, and the audit trail for changes made outside the application. Direct changes to protected records are refused by the database, but other tables are not protected that way.

### The encryption key (`PII_ENCRYPTION_KEY`) leaked

Treat it as a personal-data breach if the database may also have been copied. The key alone reveals nothing without the data.

1. Contain the database access first (previous playbook).
2. **Known limitation:** the application cannot yet re-encrypt data under a new key. Stored values carry a version tag (`enc:v1:`) so that a rotation can be added. Until it is, changing the key makes existing encrypted numbers unreadable, so **do not change it**. Ask the technical lead to build and run a rotation first.

### A payment file may have been altered, or went to the wrong place

1. Stop: tell the bank not to process the file if it has not been processed yet.
2. In the app, the payment file's download says whether it still matches what was issued. Each file's SHA-256 is recorded, along with who issued and who downloaded it.
3. Compare the bank's copy with the app's, then re-issue from the app, never from an edited copy.

### Wrong figures, or a closed period changed

1. Use Check on the close packs to find which accounts moved since the close, and the audit trail to find the postings.
2. Correct by reversal and re-posting in an open period. Reopen a closed period only through an approved reopen request.

### Data lost or corrupted

Follow [backup-and-recovery.md](backup-and-recovery.md): pick the moment, restore a Neon branch, run the restore check, then switch over.

### The app is down

1. Check `/api/health`. If the API is up but the database is down, check the Neon status page. If the API is down, read its Render logs.
2. A failed deploy: roll back to the previous deploy in the Render dashboard. The migrations so far only add tables and columns, so the previous version still runs against the newer database. Check that is still true of any migration since.

## Personal-data breach

Personal data here means employees' names, contact details, pay, bank and identity numbers, and users' details.

- **Decide quickly** whether personal data was, or may have been, seen or taken by someone not allowed to. Record the reasoning either way.
- **The regulator.** Nigeria's Data Protection Act 2023 requires notifying the Nigeria Data Protection Commission promptly, within 72 hours of becoming aware of a breach likely to risk people's rights. **The client's legal adviser should confirm the duty and the wording before go-live.**
- **The people affected.** Tell them where the risk to them is high, in plain language: what happened, what data, what they should do (for example, watch their bank account), and who to contact.
- **Evidence.** Keep the audit records that show who viewed sensitive numbers. They are logged whenever someone views or exports them.

## Incident log

| Ref | Opened | Severity | What happened | Lead | Contained | Resolved | Review done |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
