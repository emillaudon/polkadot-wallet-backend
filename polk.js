import { ApiPromise, WsProvider } from '@polkadot/api';

const wsProvider = new WsProvider('wss://westend-rpc.polkadot.io');
const api = await ApiPromise.create({ provider: wsProvider });

export default api;