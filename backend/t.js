require('dotenv').config({ path: __dirname + '/.env.t' });
(async () => {
  const { redis } = require('./dist/config/redis');
  console.log('  ping        :', await redis.ping());
  await redis.set('t:str', 'hello', { ex: 30 });
  console.log('  get string  :', await redis.get('t:str'));
  await redis.set('t:obj', JSON.stringify({ a: 1, b: 'x' }), { ex: 30 });
  console.log('  get object  :', JSON.stringify(await redis.get('t:obj')));
  console.log('  incr        :', await redis.incr('t:n'));
  console.log('  setnx first :', await redis.setnx('t:lock', '1', 30));
  console.log('  setnx again :', await redis.setnx('t:lock', '1', 30), '(false = lock held)');
  await redis.del('t:str');
  console.log('  after del   :', await redis.get('t:str'));
})();
