/**
 * **Created on 12/11/18**
 *
 * src/library/sindriConfigConfig.js
 * @author André Timermann <andre.timermann@smarti.io>
 *
 *   Realiza Pré Configuração do módulo Config para ser usado internamente pelo Sindri
 *
 */
'use strict'

const config = require('config')

const yaml = require('js-yaml')
const fs = require('fs')
const path = require('path')

// Carrega atributos default no config
const defaultConfigPath = path.join(__dirname, '../config.default.yaml')
const defaultConfig = yaml.safeLoad(fs.readFileSync(defaultConfigPath, 'utf8'))

for (const [configName] of Object.entries(defaultConfig)) {
  config.util.setModuleDefaults(configName, defaultConfig[configName])
}

module.exports = config
