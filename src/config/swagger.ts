import { RequestHandler } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import pkg from '../../package.json' with { type: 'json' };
import { env } from './env.js';


const options: swaggerJsdoc.Options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Tux Vault API Documentation',
        version: pkg.version,
        description: 'Documentação tecnica de funcionalidades do TUXVAULT.',
        contact: { name: 'whoisleoo', email: 'leomtr.dev@gmail.com' }
      },
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'connect.sid',
          },
        },
      },
      servers: [
        { url: env.APP_URL, description: env.DEV_MODE ? 'Ambiente de desenvolvimento' : 'Ambiente em produção' }
      ],
    },
    apis: ['./src/routes/*.ts'],
  };

const swaggerSpec = swaggerJsdoc(options);

export const swaggerJsonHandler: RequestHandler = (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
}

export const swaggerUiHandlers: RequestHandler[] = [
    ...swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
        swaggerOptions: { persistAuthorization: true },
        customSiteTitle: 'Tux Vault API Explorer',
    }) as RequestHandler,
]