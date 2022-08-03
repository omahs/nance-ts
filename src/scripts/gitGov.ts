import { Nance } from '../nance';
import { NanceExtensions } from '../extensions';
import { getConfig } from '../configLoader';
import { Proposal } from '../types';

async function main() {
  const config  = await getConfig();
  const nance = new Nance(config);
  const nanceExt = new NanceExtensions(config);
  
  const proposals = await nance.proposalHandler.getVoteProposals();
  Promise.all(proposals.map(async (proposal: Proposal) => {
    proposal.markdown = await nance.proposalHandler.getContentMarkdown(proposal.hash);
    return proposal;
  })).then(async (proposals) => {
    nanceExt.updateCycle(proposals, 'voting');
  });
}

main();