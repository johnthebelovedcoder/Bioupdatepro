import { Card, PageHeader } from '@/components/ui';
import { GlossaryList } from '@/components/glossary-list';
import { GLOSSARY } from '@/lib/glossary';

export const metadata = { title: 'Glossary — BioAssetPro' };

/**
 * The words the farm and the accounts use, in plain language, with what the
 * application holds each one to and where to find it (FARMING_GLOSSARY,
 * BIO_TERMINOLOGY_SCREEN_MAP).
 */
export default function GlossaryPage() {
  return (
    <>
      <PageHeader title="Glossary" subtitle={`${GLOSSARY.length} terms the farm and the accounts use, and what the app holds each one to`} />
      <Card>
        <GlossaryList entries={GLOSSARY} />
      </Card>
    </>
  );
}
