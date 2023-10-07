import { sleep } from '../utils';
import { Nance } from '../nance';
import { getSpaceInfo } from '../api/helpers/getSpaceInfo';

async function getConfigs() {
  const { config } = await getSpaceInfo(process.env.CONFIG || '');
  const nance = new Nance(config);
  await sleep(2000);
  nance.votingClose();
}

getConfigs();
