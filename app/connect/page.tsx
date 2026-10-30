import { cookies } from 'next/headers';
import ConnectClient from '../components/ConnectClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Null’s Connect · NT Scripting' };

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const params = await searchParams;
  const jar = await cookies();
  const cookieReturnTo = jar.get('nts_return_to')?.value;
  const raw = params.return_to ?? cookieReturnTo ?? '/scripts';
  const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/scripts';
  const expectedState = jar.get('nts_oauth_state')?.value ?? null;

  return <ConnectClient returnTo={returnTo} expectedState={expectedState} />;
}
