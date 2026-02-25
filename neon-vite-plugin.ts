import { postgres } from 'vite-plugin-db'

export default postgres({
  referrer: 'create-tanstack',
  dotEnvKey: 'DATABASE_URL',
})
