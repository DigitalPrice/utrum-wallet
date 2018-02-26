import Vue from 'vue'
import axios from 'axios'

import App from './App'
import router from './router'
import store from './store'

import BootstrapVue from 'bootstrap-vue'
Vue.use(BootstrapVue);

import VueSweetAlert from 'vue-sweetalert'
Vue.use(VueSweetAlert)

import VueQriously from 'vue-qriously'
Vue.use(VueQriously)

import VueClipboard from 'vue-clipboard2'
Vue.use(VueClipboard)

import VueQrcodeReader from 'vue-qrcode-reader'
Vue.use(VueQrcodeReader)

import jQuery from 'jquery'
require('bootstrap/dist/css/bootstrap.min.css')

if (!process.env.IS_WEB) Vue.use(require('vue-electron'))

axios.config =  axios.create({
  timeout: 10000,
  transformRequest: [(data) => JSON.stringify(data.data)],
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }
});

Vue.http = Vue.prototype.$http = axios
Vue.config.productionTip = false

/* eslint-disable no-new */
new Vue({
  components: { App },
  router,
  store,
  template: '<App/>'
}).$mount('#app')
