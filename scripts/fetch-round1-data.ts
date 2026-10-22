import { fetchRound1Data, ROUND1_RELEASE } from '../apps/api/src/services/round1-data';

/**
 * Downloads the 1st-round data that is not in git (baseline and demo replay) from the GitHub
 * Release, checks the SHA-256 hashes recorded in the repository and installs them.
 *   pnpm data:1t
 */
console.log(`Origem: ${ROUND1_RELEASE}`);
for (const { target, result } of await fetchRound1Data())
  console.log(`${result === 'installed' ? 'instalado' : 'já presente'}: ${target}`);
