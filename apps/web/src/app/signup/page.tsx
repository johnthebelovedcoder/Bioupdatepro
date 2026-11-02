import { SignupForm } from '@/components/signup-form';
import { availableProviders } from './actions';

export const metadata = { title: 'Create your farm — BioAssetPro' };

export default async function SignupPage() {
  const providers = await availableProviders();
  const hasSocial = providers.google || providers.facebook;

  return <SignupForm hasSocialSignIn={hasSocial} />;
}
