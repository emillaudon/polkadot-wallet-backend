import { Keyring } from '@polkadot/api';
import express from 'express';
import api from './polk.js';
import bip39 from 'bip39';

import db from './firebaseSetup.js';
import { Timestamp } from '@google-cloud/firestore';
import bodyParser from 'body-parser';

import BN from 'bn.js'


//const api = require('./polk.js');
const TRANSFER = 'Transfer';
const TESTNET = true;
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const port = 3000;

let addresses = [];

////Balance of chosen address
app.get('/balanceOf/:address', async (req, res) => {
    const address = req.params.address;
    const now = await api.query.timestamp.now();

    const { nonce, data: balance } = await api.query.system.account(address);

    res.send(`${now}: balance of ${balance.free} and a nonce of ${nonce}`)
});


///////Generate new wallet
app.get('/generateWallet/:uid', async (req, res) => {
    const uid = req.params.uid;
    const mnemonic = generateMnemonic();

    const newWallet = await createCredentials(mnemonic);

    saveNewWallet(mnemonic, newWallet.address, uid);

    res.send(mnemonic);
});

function generateMnemonic() {
    return bip39.generateMnemonic();
}

async function createCredentials(mnemonic) {
    const keyring = new Keyring({ type: 'sr25519' });
    let format = TESTNET ? 42 : 0;
    keyring.setSS58Format(format);
    const newPair = keyring.addFromUri(mnemonic);

    //var info = await api.query.system.account(newPair.address);

    return newPair;
}

const saveNewWallet = async (mnemonic, address, uid) => {
    const document = db.collection('users').doc(uid).collection('wallets').doc(address);
    let timestamp = Date.now()

    await document.set({
        mnemonic: mnemonic,
        balance: 0,
        timestamp: timestamp
    });
    saveToWatchList(address, uid);
}

const saveToWatchList = async (address, uid) => {
    const document = db.collection('addresses').doc(address)
    await document.set({
        address: address,
        uid: uid
    });
    addresses.push(address);
}
//////////////////


//////Perform transaction
app.post('/transact/', async (req, res) => {
    const sender = req.query.sender;
    const user = req.query.user;
    const recipient = req.query.recipient;
    const amount = req.query.amount;

    const result = await db.collection('users').doc(user).collection('wallets').doc(sender).get();
    let resData = result.data()

    let mnemonic = resData.mnemonic;

    let credentials = await createCredentials(mnemonic)
    await performTransaction(credentials, recipient, amount, user);

    res.send('Transaction performed')
});

async function performTransaction(sender, receiver, amount, user) {
    console.log();
    const unsub = await api.tx.balances
        .transfer(receiver, parseFloat(amount))
        .signAndSend(sender, ({ events = [], status }) => {
            console.log(`Current status is ${status.type}`);

            if (status.isFinalized) {
                console.log(`Transaction included at blockhash ${status.asFinalized}`);

                events.forEach(({ phase, event: { data, method, section } }) => {
                    console.log(`\t' ${phase}: ${section}.${method}:: ${data}`);
                });
                let data = [
                    sender.address,
                    receiver,
                    amount
                ]

                

                saveTransaction(data, false);

                if(addresses.includes(receiver)) {
                    console.log('SINEHTJE HERE')
                    saveTransaction(data, true)
                }

                unsub();
            }
        });
}
///////////////////////////////////


///////Calculate transaction cost
app.get('/transactionWeight/:amount', async (req, res) => {
    const amount = req.params.amount;
    const sender = req.params.sender;
    const recipient = req.params.recipient;

    let info;

    try {
        info = await api.tx.balances.transfer(addresses[0], amount).paymentInfo(addresses[0]);
        console.log(info)

    } catch (e) {
        console.log(e)
    }

    //res.send(`transaction will have a weight of ${weight}, with ${partialFee.toHuman()} weight fees`);
    res.send(`${info.weight.toString()}`);
});


///////Converts dot value to DOT format.
const convertToDot = (amountData) => {
    let amountSplit = amountData.split(' ');
    let amount = parseFloat(amountSplit[0])

    let res = 0.0;

    if (amountData.includes('uDOT')) {
        res = amount * 0.000001
    } else if (amountData.includes('mDOT')) {
        res = amount * 0.001
    } else if (amountData.includes('DOT')) {
        res = amount;
    } else if (amountData.includes('kDOT')) {
        res = amount * 1000;
    }
    
    return res;
}

//////Testnet
const convertToDotTestNet = (amountData) => {
    let amountSplit = amountData.split(' ');
    let amount = parseFloat(amountSplit[0])

    let res = 0.0;

    if (amountData.includes('µWND')) {
        res = amount * 0.000001
    } else if (amountData.includes('mWND')) {
        res = amount * 0.001
    } else if (amountData.includes('WND')) {
        res = amount;
    } else if (amountData.includes('kWND')) {
        res = amount * 1000;
    }
    
    return res;
}


////////Check for addresses of users in new blocks
const checkForAddresses = (data) => {

    let from = data[0].toHuman().toString();
    let to = data[1].toHuman().toString();
    let amount = data[2].toHuman().toString();

    if (addresses.includes(from)) {
        console.log('address included');
        saveTransaction(data, false)
    } else if (addresses.includes(to)) {
        saveTransaction(data, true)
    }
}

///////Saves transaction to the correct wallet
const saveTransaction = async (data, incoming) => {
    console.log('saving');

    let from = data[0].toString();
    let to = data[1].toString();
    let amount = data[2].toString();

    let receiving = incoming;
    let address = incoming ? to : from;

    try {
        from = data[0].toHuman().toString();
        to = data[1].toHuman().toString();
        amount = data[2].toHuman().toString();

        amount = TESTNET ? convertToDotTestNet(amount) : convertToDot(amount)

        address = incoming ? to : from;

        
    } catch (e) {
        
    }
    const result = await db.collection('addresses').doc(address).get();
    let resData = result.data()
    let uid = resData.uid;
  
    const collection = db.collection('users').doc(uid).collection('wallets').doc(address).collection('transactions')
    let timestamp = Date.now()

    await collection.add({
        from: from,
        to: to,
        amount: amount,
        receiving: receiving,
        timestamp: timestamp
    });

    updateBalance(address, uid);
}

//////Updates Balance of address
const updateBalance = async (address, uid) => {
    const { nonce, data: balance } = await api.query.system.account(address);

    let balanceInDot = TESTNET ? convertToDotTestNet(balance.toHuman().free) : convertToDot(balance.toHuman().free)

    const collection = db.collection('users').doc(uid).collection('wallets').doc(address)

    console.log('balance updated of walllet: ' + address + ' of user: ' + uid)
    
    await collection.update({
        balance: balanceInDot
    });
}

/////Listes to all new blocks and checks if event equals transfer
const listenToEvents = async () => {
    console.log(11)
    api.query.system.events((events) => {
        console.log(`\nReceived ${events.length} events:`);

        events.forEach((record) => {
            let event = record.event

            if (event.method == TRANSFER) {
                checkForAddresses(event.data);

            }
        });
    });
}

const getAddressesToWatch = async () => {
    const result = await db.collection('addresses').get();
    result.forEach((doc) => {
        let address = doc.id;
        addresses.push(address);
    });
    
}

app.listen(port, async () => {
    listenToEvents();
    getAddressesToWatch();

    console.log("listening on port " + port);
});
///////////////////////////////////////////////////////

















///////////////
////Not used//
/////////////


////Get chain name and latest header
app.get('/chainAndHeader', async (req, res) => {
    const chain = await api.rpc.system.chain();

    const lastHeader = await api.rpc.chain.getHeader();

    res.send(`${chain}: last block #${lastHeader.number} has hash ${lastHeader.hash}`)
});

//////Genesis Hash
app.get('/genesisHash', async (req, res) => {
    const document = db.doc('posts/intro-to-firestore');

    await document.set({
        title: 'Welcome to Firestore',
        body: 'Hello World',
    });
    console.log('Entered new data into the document');

    res.send(api.genesisHash.toHex());

});

//////Gets all headers
const getAllHeads = async () => {
    const allHeads = await api.rpc.chain.subscribeAllHeads((allHeaders) => {
        console.log(allHeaders);

    });
}


////// Listen to new headers
const listenToNewHeaders = async () => {
    const chain = await api.rpc.system.chain();
    await api.rpc.chain.subscribeNewHeads((lastHeader) => {
        console.log(lastHeader.number.toHuman())
        console.log(lastHeader.toHuman())
        console.log(lastHeader.digest.toHuman())
    });
    const { nonce, data: balance } = await api.query.system.account(address);
};