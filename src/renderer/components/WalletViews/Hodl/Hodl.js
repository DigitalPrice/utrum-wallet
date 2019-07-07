/** ***************************************************************************
 * Copyright © 2018 Monaize Singapore PTE. LTD.                               *
 *                                                                            *
 * See the AUTHORS, and LICENSE files at the top-level directory of this      *
 * distribution for the individual copyright holder information and the       *
 * developer policies on copyright and licensing.                             *
 *                                                                            *
 * Unless otherwise agreed in a custom licensing agreement, no part of the    *
 * Monaize Singapore PTE. LTD software, including this file may be copied,    *
 * modified, propagated or distributed except according to the terms          *
 * contained in the LICENSE file                                              *
 *                                                                            *
 * Removal or modification of this copyright notice is prohibited.            *
 *                                                                            *
 ******************************************************************************/

import { BigNumber } from 'bignumber.js';
import bitcore from 'bitcore-lib';
import axios from 'axios';
import SelectDropdown from '@/components/SelectDropdown/SelectDropdown.vue'

const { clipboard } = require('electron');
const { shell } = require('electron');
const moment = require('moment');

import HodlHistory from '@/components/WalletViews/HodlHistory/HodlHistory.vue';

export default {
  name: 'hodl',
  components: {
    'hodl-history': HodlHistory,
    SelectDropdown
  },

  mounted () {
    // initialize hodl wallet
    this.hodlData = this.fillHodlData()
    // set default value for "time period"
    this.onTimeChange(this.timeList[0])
  },

  data () {
    return {
      hodlInput: {
        amount: null,
        daysToLock: null
      },
      hodlData: {
        unlockTime: '',
        scriptAddress: '',
        redeemScript: '',
      },
      unlockTimeDate: '',
      rawtx: null,
      lastTxId: null,
      reloadTxHistory: null,
      isClipboard: false,
      satoshiNb: 100000000,
      blocks: 1,
      coins: [],
      selectedCoin: {},
      timeList: [
        {
          // text: '60 days - 1%',
          // value: 60
          text: '6 minutes - 1%', /// TESTING
          value: 6 /// TESTING
        },
        {
          // text: '120 days - 2.4%',
          // value: 120
          text: '12 minutes - 2.4%', /// TESTING
          value: 12 /// TESTING
        },
      ],
      // boostrap-vue related
      dismissSecs: 10,
      dismissAlertCountDown: 0,
      dismissErrorCountDown: 0,
      alertText: '',
      errorText: ''
    };
  },

  created () {
    // populate coin list
    this.$store.getters.enabledCoins.map(coin => {
      if (coin.hasHodlProgram === true) {
        this.coins.push({
          ticker: coin.ticker,
          label: `${coin.name} (${coin.ticker})`,
          image_url: require(`@/assets/${coin.ticker.toUpperCase()}-32x32.png`)
        })
      }
    });
    // set first coin on the list as default
    this.selectedCoin = this.coins[0]
  },

  methods: {

    updateCoin(value) {
      if (value) {
        this.selectedCoin = value;
        this.reloadTransactionHistory(100)
      }
    },

    // reload transaction history child component
    reloadTransactionHistory (milisec) {
      let timestamp = Date.now() // necessary
      this.reloadTxHistory = [milisec, timestamp]
    },

    // vue-select stuff
    onTimeChange(selectedOption) {
      if (selectedOption) {
        this.hodlInput.daysToLock = selectedOption.value
        this.hodlCreate()
      }
    },

    // for copy button
    onCopy() {
      const self = this;
      this.isClipboard = true;
      setTimeout(() => {
        self.isClipboard = false;
      }, 1000);
    },

    // update hodl unlock time
    updateUnlockTime () {
      // convert days to seconds
      // var secondsToLock = (this.hodlInput.daysToLock * 86400) /// TESTING
      var secondsToLock = (this.hodlInput.daysToLock * 60)
      var unlockTime = (Date.now() / 1000 | 0) + secondsToLock
      this.hodlData.unlockTime = unlockTime
      this.unlockTimeDate = (
        this.dateFormat(unlockTime) + " (in " +
        this.hodlInput.daysToLock + " days)"
      )
    },

    // hodl script creation
    hodlCreate () {
      var vm = this

      // update unlock time to now
      vm.updateUnlockTime()

      // flush data
      vm.hodlData["redeemScript"] = null
      vm.hodlData["scriptAddress"] = null
      vm.rawtx = null
      vm.lastTxId = null

      // get redeem script
      var writer = new bitcore.encoding.BufferWriter()
      var redeemScript = new bitcore.Script()
        .add(writer.writeUInt32LE(vm.hodlData.unlockTime).bufs[0])
        .add('OP_NOP2')
        .add('OP_DROP')
        .add(new Buffer(vm.hodlData.publicKey, 'hex'))
        .add('OP_CHECKSIG')
        .toHex()

      // get address from redeem script
      var scriptBuffer = new bitcore.Script(redeemScript).toBuffer()
      var scriptSha256 = bitcore.crypto.Hash.sha256(scriptBuffer)
      var scriptSha256ripemd160 = bitcore.crypto.Hash.ripemd160(scriptSha256)
      var scriptAddress = bitcore.Address.fromScriptHash(scriptSha256ripemd160)

      // update hodl data object
      vm.hodlData["redeemScript"] = redeemScript.toString()
      vm.hodlData["scriptAddress"] = scriptAddress.toString()
    },

    // get utxos and call build transaction function
    getTx () {
      var vm = this

      // re-create hodl script just in case
      vm.hodlCreate()

      console.log('getting utxos...')
      // construct call url
      var url = (
        vm.explorer +
        "insight-api-komodo/addr/" +
        vm.hodlData.address +
        "/utxo"
      )
      // make call to explorer api to get utxos, and build transaction
      axios
        .get(url)
        .then(response => {
          // check if there are enough funds
          let utxos = response.data
          let balance = 0
          for ( var i in utxos ) {
              balance += utxos[i].satoshis
          }
          if ( balance / vm.satoshiNb < vm.hodlInput.amount ) {
            // boostrap-vue alert
            let errorMessage = "Insufficient funds, please check your balance."
            vm.showError(errorMessage)
            // delete wrong amount
            vm.hodlInput.amount = null
            throw errorMessage
          }
          // so far so good, build transaction
          vm.rawtx = vm.buildTx(response.data)
          console.log('raw transaction stored')
        })
        .catch(e => {
          console.log(e)
        });
    },

    // build the funding transaction
    buildTx (utxos) {
      console.log('building transaction...')
      var vm = this

      // prepare variables to build our transaction
      var toAddress = vm.hodlData.scriptAddress
      var myAddress = vm.hodlData.address
      var amount = Math.round(vm.hodlInput["amount"] * vm.satoshiNb)
      var op_return = "REDEEM SCRIPT " + vm.hodlData.redeemScript
      var privateKey = vm.hodlData.privateKey

      // https://bitcore.io/api/lib/transaction#serialization-checks
      var opts = {
        disableDustOutputs: true
      }

      // workaround to insight/komodod non-confirmed-utxos bug
      let myScriptPubkey = new bitcore.Script()
        .add('OP_DUP')
        .add('OP_HASH160')
        .add(bitcore.Address(myAddress).hashBuffer)
        .add('OP_EQUALVERIFY')
        .add('OP_CHECKSIG')
        .toHex()
      for (var i in utxos) {
        utxos[i].scriptPubKey = myScriptPubkey
      }

      // use bitcore to build the transaction
      var rawtx = new bitcore.Transaction()
        .from(utxos)
        .to(toAddress, amount)
        .change(myAddress)
        .addData(op_return)
        .sign(privateKey)
        .serialize(opts)

      vm.lastTxId = null

      return rawtx
    },

    // submit transaction for validation and broadcasting
    submitTx () {
      var vm = this

      var rawtx = vm.rawtx
      vm.rawtx = null
      vm.hodlInput["amount"] = null

      console.log('broadcasting transaction...')

      var url = vm.explorer + "hodl-api/submit-tx/"
      axios
        .post(url, {'rawtx': rawtx})
        .then(response => {
          console.log(response.data)
          if (!response.data.error) {
            vm.lastTxId = response.data.txid
            // reload transaction history
            this.reloadTransactionHistory(1000)
            // boostrap-vue alert
            vm.showAlert("Funds locked successfully!")
          } else {
            vm.showError(response.data.error)
            throw response.data.error
          }
        })
        .catch(e => {
          console.log(e)
        });
    },

    // store hodl related data
    fillHodlData () {
      var dict = {};

      var privateKey = new bitcore.PrivateKey(
        this.wallet.privKey.toString('hex')
      );
      dict["privateKey"] = privateKey.toString();

      var publicKey = new bitcore.PublicKey(privateKey);
      dict["publicKey"] = publicKey.toString();

      var address = publicKey.toAddress();
      dict["address"] = address.toString();

      return dict;
    },

    // convert unix time to human readable time
    dateFormat (time) {
      const blockchainDateUtc = moment.utc(time * 1000);
      const dateString = (
        moment(blockchainDateUtc)
        .local()
        .format('DD MMM, hh:mm A')
      )
      return dateString;
    },

    // for top message link
    openLink(link){
      shell.openExternal(link);
    },

    // boostrap-vue related
    alertCountDownChanged (n) {
      this.dismissAlertCountDown = n
    },
    errorCountDownChanged (n) {
      this.dismissErrorCountDown = n
    },
    showAlert (msg) {
      this.dismissAlertCountDown = this.dismissSecs
      this.alertText = msg
    },
    showError(msg) {
      this.dismissErrorCountDown = this.dismissSecs
      this.errorText = msg
    }

  },

  computed: {
    // get wallet data
    wallet () {
      return this.$store.getters.getWalletByTicker(this.selectedCoin.ticker);
    },

    // get explorer url
    explorer () {
      return this.wallet.coin.explorer
    },

    calculatedReward () {
      let daysToLock = this.hodlInput.daysToLock
      // this logarithmic function returns 1 for 60 days and 2.4 for 120 days
      // let percentage = 2.0197738315 * Math.log(daysToLock) - 7.26965
      let percentage = 2.0197738315 * Math.log(daysToLock * 10) - 7.26965 /// TESTING
      return this.hodlInput.amount * ( percentage * 0.01 )
    },
  }
}
