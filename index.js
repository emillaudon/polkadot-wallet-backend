import { Keyring } from '@polkadot/api';
import express from 'express';
import api from './polk.js';
import bip39 from 'bip39';

import db from './firebaseSetup.js';
import { Timestamp } from '@google-cloud/firestore';

import BN from 'bn.js'


//const api = require('./polk.js');
const TRANSFER = 'Transfer';
const TRANSFER_KEEP_ALIVE = ''
const app = express();
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
    keyring.setSS58Format(0);
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
app.get('/transact', async (req, res) => {
    const sender = req.params.sender;
    const recipient = req.params.recipient;

    await performTransaction(sender, recipient);

    res.send('Transaction performed')
});

async function performTransaction(sender, receiver) {
    const unsub = await api.tx.balances
        .transfer(receiver.address, 1)
        .signAndSend(sender, ({ events = [], status }) => {
            console.log(`Current status is ${status.type}`);

            if (status.isFinalized) {
                console.log(`Transaction included at blockhash ${status.asFinalized}`);

                events.forEach(({ phase, event: { data, method, section } }) => {
                    console.log(`\t' ${phase}: ${section}.${method}:: ${data}`);
                });

                unsub();
            }
        });
}
///////////////////////////////////


///////Calculate transaction cost
app.get('/transactionWeight', async (req, res) => {
    const sender = req.params.sender;
    const recipient = req.params.recipient;

    const transfer = api.tx.balances.transfer(recipient, 100);

    //const { partialFee, weight } = await transfer.paymentInfo( - put key here - );

    res.send(`transaction will have a weight of ${weight}, with ${partialFee.toHuman()} weight fees`);
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


////////Check for addresses of users in new blocks
const checkForAddresses = (data) => {

    let from = data[0].toHuman().toString();
    let to = data[1].toHuman().toString();

    let amount = data[2].toHuman().toString();

    console.log('from: ' + from);
    console.log('to: ' + to);
    console.log('amount: ' + amount);
    console.log('ja')

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
    console.log(incoming)
    let from = data[0].toHuman().toString();
    let to = data[1].toHuman().toString();
    let amount = data[2].toHuman().toString();
    amount = convertToDot(amount)

    let receiving = incoming;

    let address = incoming ? to : from;
    console.log(address)

    const result = await db.collection('addresses').doc(address).get();
    let resData = result.data()
    let uid = resData.uid;

    const collection = db.collection('users').doc(uid).collection('wallets').doc(address).collection('transactions')
    let timestamp = Date.now()
    console.log('saving2');
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
    let balanceInDot = convertToDot(balance.toHuman().free)
    console.log(balanceInDot);

    const collection = db.collection('users').doc(uid).collection('wallets').doc(address)
    
    await collection.update({
        balance: balanceInDot
    });
}

/////Listes to all new blocks and checks if event equals transfer
const listenToEvents = async () => {
    api.query.system.events((events) => {
        console.log(`\nReceived ${events.length} events:`);

        events.forEach((record) => {
            let event = record.event
            //console.log(event.method);

            //console.log('from!: ' + from);

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
};