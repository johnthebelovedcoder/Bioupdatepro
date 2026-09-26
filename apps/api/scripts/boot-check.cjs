// Builds the API's dependency graph from the compiled app — every module,
// provider and controller — without listening or connecting to a database.
//
// The integration tests construct services by hand, so a controller asking
// for a provider its module does not export passes every test and then
// crashes the deployed API at start (2026-09-26: ProductionOrderController
// and JointCostService). This catches that in CI instead.
const path = require('path');

process.env.DATABASE_URL ||= 'postgresql://boot-check:unused@127.0.0.1:1/none';
process.env.JWT_SECRET ||= 'boot-check-only-this-is-not-a-real-secret-0123456789';

const dist = path.resolve(__dirname, '..', 'dist');
const { NestFactory } = require(require.resolve('@nestjs/core', { paths: [dist] }));
const { AppModule } = require(path.join(dist, 'app.module.js'));

NestFactory.create(AppModule, { logger: ['error'], abortOnError: false })
  .then(() => {
    console.log('Boot check passed: every controller and provider resolves.');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Boot check failed: ${error.message.split('\n')[0]}`);
    process.exit(1);
  });
