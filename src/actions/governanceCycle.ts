import { doltSys } from './doltSys';

export const incrementGovernanceCycle = async (space: string) => {
  await doltSys.incrementGovernanceCycle(space);
  return true;
};
