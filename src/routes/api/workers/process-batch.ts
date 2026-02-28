import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/workers/process-batch')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/api/workers/process-batch"!</div>
}
