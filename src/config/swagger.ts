import { Express } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import  { version} from '../../package.json';
import { env } from './env.js';


const options: swaggerJsdoc.Options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Tux Vault API Documentation',
        version,
        description: 'Documentação tecnica de funcionalidades do TUXVAULT.',
        contact: { name: 'whoisleoo', email: 'leomtr.dev@gmail.com' }
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },


      servers: [
        { url: env.APP_URL, description: env.DEV_MODE ? 'Ambiente de desenvolvimento' : 'Ambiente em produção' }
      ],
    },
    apis: ['./src/routes/*.ts', './src/models/*.ts'], 
  };
  
  const swaggerSpec = swaggerJsdoc(options);
  
  export function setupSwagger(app: Express) {
    
    app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: "Tux Vault API Explorer"
    }));
  }