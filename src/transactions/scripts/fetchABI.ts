// Usage: ts-node fetchABI.ts <address> <tokenName>

import axios from 'axios';
import fs from 'fs';
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
import { keys } from '../../keys';
import { myProvider } from '../../utils';
import { DoltSysHandler } from '../../dolt/doltSysHandler';
import { Network } from '../../types';

export const fetchABI = async (address: string, network?: Network) => {
  const BASE = (network === 'mainnet') ? 'https://api.etherscan.io' : `https://api-${network}.etherscan.io`; 
  const url = `${BASE}/api?module=contract&action=getabi&address=${address}&apikey=${keys.ETHERSCAN_KEY}`;
  const response = await axios.get(url);
  return JSON.parse(response.data.result);
}

export const fetchABIAndWriteToFile = async (address: string, tokenName: string) => {
  // https://github.com/Rubilmax/etherscan-abi/blob/48e7ed7fabeac4a8addf4e9a8d03324c96d34791/src/fetch.ts#LL36C1-L41C1
  let iAddress;
  try { iAddress = await getImplementationAddress(myProvider(), address); } catch { iAddress = address; }
  const output = JSON.stringify({
    address,
    abi: await fetchABI(iAddress),
  }, null, "  ");
  fs.writeFileSync(`${__dirname}/../tokens/${tokenName}.json`, output);
}

export const fetchABIAndWriteToDolt = async (address: string, tokenName: string, type = 'ERC20', network = 'mainnet' as Network) => {
  // 
  let iAddress;
  try { iAddress = await getImplementationAddress(myProvider(network), address); } catch { iAddress = address; }
  const abi = await fetchABI(iAddress, network);
  const doltSysHandler = new DoltSysHandler();
  await doltSysHandler.writeContractData(tokenName, type, address, abi);
}

// fetchABIAndWriteToFile(process.argv[2], process.argv[3]);
fetchABIAndWriteToDolt(process.argv[2], process.argv[3], process.argv[4], process.argv[5] as Network);