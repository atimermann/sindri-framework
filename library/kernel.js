/**
 * **Created on 13/11/18**
 *
 * src/library/kernel.js
 * @author André Timermann <andre.timermann@smarti.io>
 *
 *   Nucleo do Framework, onde o servidor é configurado e inicializado.
 *   Inicializa Expressjs, aplicações e sobre o servidor
 *
 *   Pode ser carregado standalone ou através de cluster
 *
 *   Mais módulos para o Express: https://github.com/expressjs
 *
 *  Antes de alterar leia sobre Segurança:
 *  https://expressjs.com/en/advanced/best-practice-security.html
 *
 */
'use strict'

const { logger } = require('./logger')
const express = require('express')
const bodyParser = require('body-parser')
const morgan = require('morgan')
const helmet = require('helmet')
const compression = require('compression')
const { Writable } = require('stream')
const ApplicationController = require('./applicationController')
const os = require('os')
const { join } = require('path')
const http = require('http')
const figlet = require('figlet')

require('dotenv').config()

// const config = require('../vendor/config/lib/config') // Fix para funcionar com pkg, projeto config não comṕativel, copiado para vendor
const config = require('config')

module.exports = {

  /**
   * Inicializa Servidor Sindri
   *
   * // @param serializedApplication  {String} Array listando todas as aplicações e atributos Serializado

   * @param application {Object}    Dados da aplicação que está sendo carregada
   * @param scWorker    {SCWorker}  Objeto SCWorker (https://socketcluster.io/#!/docs/api-scworker) instancia do Cluster atual
   *
   */
  async run (application, scWorker) {
    global.__BASE = join(application.rootPath, '/')

    logger.info('Inicializando Sindri Kernel...')

    if (process.env.NODE_ENV === undefined) throw new Error('Environment is not defined, create an .env file with attribute NODE_ENV.')

    // Deserializa informações da aplicação
    // let application = JSON.parse(serializedApplication)

    const httpServer = http.createServer()

    const sindriPackageInfo = require('../package.json')

    /**
     * Rota para acesso a recursos estáticos (ex: jpeg, html, js etc...)
     * Padrão /static
     *
     * @type {string}
     */
    this.staticRoute = process.env.STATIC_ROUTE || config.get('server.staticRoute')

    /**
     * Habilita o acesso a recursos estáticos via CDN (se True desabilita servidor de arquivos estático do Express)
     *
     * @type {boolean}
     */
    this.cdn = (process.env.CDN === undefined)
      ? config.get('server.cdn')
      : process.env.CDN

    /**
     * Url Base do Servidor CDN
     *
     * @type {*|value}
     */
    this.cdnUrl = process.env.CDN_URL || config.get('server.cdnUrl')

    console.log(figlet.textSync(`\n${application.name}`))
    logger.info('==============================================================')
    logger.info(`Project            : ${application.name}`)
    logger.info(`Root Path          : ${application.rootPath}`)
    logger.info(`Node Version       : ${process.version}`)
    logger.info(`Environment        : ${process.env.NODE_ENV}`)
    logger.info(`Port               : ${process.env.PORT || config.get('server.port')}`)
    logger.info(`Pid                : ${process.pid}`)
    logger.info(`Hostname           : ${os.hostname()}`)
    logger.info(`Platform           : ${os.platform()}`)
    logger.info(`Arch               : ${os.arch()}`)
    logger.info(`Sindri Version     : ${sindriPackageInfo.version}`)
    logger.info(`Application Version: ${process.env.npm_package_version}`)
    logger.info('==============================================================')

    // Configura ExpressJs
    const app = this._configureExpressHttpServer(httpServer, application)

    // Carrega Aplicações
    await this._loadApplications(app, application, scWorker)

    // Inicializa Servidor HTTP
    this._startHttpServer(httpServer)

    logger.info('Kernel Loaded!')
  },

  /**
   * Configura Servidor Express
   *
   * Nota: Não utilizamos engine de views do express, e sim externo está implementado no controller
   *
   * @param httpServer  {Object}  Objeto HTTP (Nodejs)
   * @param application {Object}  Informações sobre a aplicação que está sendo carregada
   *
   * @returns {Object}  Objeto Express
   * @private
   */
  _configureExpressHttpServer (httpServer, application) {
    const app = express()

    httpServer.on('request', app)

    /// /////////////////////////////////////////////////
    // Regista log de acesso no express
    // Deve ser registrado antes dos demais middleware para registrar todos os logs
    /// /////////////////////////////////////////////////
    app.use(
      morgan(
        config.get('server.log.format'),
        {

          stream: new Writable({
            write (chunk, encoding, callback) {
              logger.info('[HTTP] ' + chunk.toString('utf8', 0, chunk.length - 1))
              callback()
            }
          })
        }
      )
    )

    /// /////////////////////////////////////////////////
    // Segurança
    // Ref: https://helmetjs.github.io/
    /// /////////////////////////////////////////////////
    app.use(helmet())

    /// /////////////////////////////////////////////////
    // Cors
    // TODO: https://github.com/expressjs/cors
    /// /////////////////////////////////////////////////
    app.use((req, res, next) => {
      // res.header('Access-Control-Allow-Origin', '*');
      // res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
      // res.header('Access-Control-Allow-Headers', 'Content-Type');
      next()
    })

    /// /////////////////////////////////////////////////
    // TODO: Parametrizar possibilidade de usar CDN ou servidor separado
    // Arquivos Estático
    /// /////////////////////////////////////////////////

    if (!this.cdn) {
      // ref: https://github.com/zeit/pkg#snapshot-filesystem
      let sourceStaticFiles

      if (config.get('server.loadStaticFromPackage')) {
        sourceStaticFiles = join(application.rootPath, 'public')
        logger.info(`Carregando arquivos estáticos do pacote (${sourceStaticFiles})`)
      } else {
        sourceStaticFiles = join(process.cwd(), 'public')
        logger.info(`Carregando arquivos estáticos do local (${sourceStaticFiles})`)
      }

      app.use(this.staticRoute, express.static(sourceStaticFiles))
    }

    /// /////////////////////////////////////////////////
    // BodyParser
    // Ref: https://github.com/expressjs/body-parser
    /// /////////////////////////////////////////////////
    app.use(bodyParser.urlencoded({
      extended: false,
      limit: config.get('server.urlenconded.limit')
    }))

    // Configurar Json
    app.use(bodyParser.json({
      limit: config.get('server.json.limit')
    }))

    /// /////////////////////////////////////////////////
    // Compressão
    /// /////////////////////////////////////////////////
    app.use(compression())

    return app
  },

  /**
   * Carrega Aplicações
   *
   * @param app         {Object}    Objeto Expressjs
   * @param application {Object}    Informações sobre a Aplicação
   * @param scWorker    {SCWorker}  Objeto Cluster, habilitado apenas se cluster for ativo
   *
   * @private
   */
  async _loadApplications (app, application, scWorker) {
    const controllers = []

    /**
     * Arvore de caminho das aplicações
     *
     * @type {{}}
     */
    const applicationPathTree = {}

    /// ///////////////////////////////////////////////////////////////////////////
    // Carrega Controllers
    /// ///////////////////////////////////////////////////////////////////////////
    for (const controller of await ApplicationController.getControllers(application.applications)) {
      /// //////////////////////////////////////////
      // Instancia do Expressjs
      /// //////////////////////////////////////////
      controller.app = app

      /// //////////////////////////////////////////
      // Cria Rota Especifica para este controlador
      /// //////////////////////////////////////////
      controller.router = express.Router({
        strict: true
      })

      // Extrai Path e cria arvore
      if (applicationPathTree[controller.applicationName] === undefined) {
        applicationPathTree[controller.applicationName] = {}
      }

      applicationPathTree[controller.applicationName][controller.appName] = controller.appPath

      /// //////////////////////////////////////////
      // Static / CDN
      /// //////////////////////////////////////////

      if (this.cdn) {
        controller.staticBaseUrl = this.cdnUrl
      } else {
        controller.staticBaseUrl = this.staticRoute
      }

      /// //////////////////////////////////////////
      // SocketCluster
      /// //////////////////////////////////////////

      if (scWorker !== undefined) {
        // Ref: https://socketcluster.io/#!/docs/api-scserver
        controller.socketServer = scWorker.scServer
        controller.socketWorker = scWorker
      }

      /// //////////////////////////////////////////
      // Adiciona na Lista de controllers
      /// //////////////////////////////////////////
      controllers.push(controller)
    }

    for (const controller of controllers) {
      controller.applicationsPath = applicationPathTree
    }

    /// ///////////////////////////////////////////////////////////////////////////////////
    // middleware - PRÉ
    /// ///////////////////////////////////////////////////////////////////////////////////

    for (const controller of controllers) {
      await controller.pre()
    }

    for (const controller of controllers) {
      await controller.setup()
    }

    /// ///////////////////////////////////////////////////////////////////////////////////
    // Controller
    /// ///////////////////////////////////////////////////////////////////////////////////

    for (const controller of controllers) {
      // Configura Rotas
      await controller.routes()

      // Retorna e define Rota Configurada pelo controller
      controller.path
        ? app.use(controller.path, controller.router)
        : app.use(controller.router)
    }

    /// ///////////////////////////////////////////////////////////////////////////////////
    // middleware - PÓS
    /// ///////////////////////////////////////////////////////////////////////////////////
    for (const controller of controllers) {
      await controller.pos()
    }

    logger.debug('Applications Loaded!')
  },

  /**
   * Inicializa Servidor HTTP
   *
   * @param httpServer
   */
  _startHttpServer (httpServer) {
    const port = process.env.PORT || config.get('server.port')

    logger.info(`Inicializando HTTP_SERVER. Porta: ${port}!`)

    httpServer.listen(port, () => {
      logger.info('--------------------------------------------------------------')
      logger.info('Address:' + httpServer.address().address)
      logger.info('Port   :' + httpServer.address().port)
      logger.info('Family :' + httpServer.address().family)
      logger.info('--------------------------------------------------------------')
      logger.info('Servidor http iniciado!')
    })
  }

}
