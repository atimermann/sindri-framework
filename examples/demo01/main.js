/**
 * **Created on 20/09/18**
 *
 * exemples/demo01/main.js
 * @author André Timermann <andre.timermann@smarti.io>
 *
 * Demostração Básica do Uso do Framework, com estrutura mínima
 *
 */
'use strict'

const Application = require('sindri-framework/application')
const Server = require('sindri-framework/server')

let demoApplication = new Application(__dirname, 'Demo01', {
  optionX: 'X'
})

demoApplication.loadAppplication(require('../demo01b'), {
  optionA: 'Foo',
  optionB: true,
  optionC: 2.0
})

if (require.main === module) {
  // Inicializa Servidor
  Server.init(demoApplication)
} else {
  module.exports = demoApplication
}
