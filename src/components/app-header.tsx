import { Square } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from './ui/button'
import { UserMenu } from '#/components/user-menu'

interface AppHeaderProps {
  user: {
    name: string
    email: string
    image?: string | null
  }
}

function Logo() {
  return (
    <Link className="flex items-center gap-2" to="/">
      <Button size="icon">
        <Square className="size-4" />
      </Button>
    </Link>
  )
}

export function AppHeader({ user }: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between px-4">
      <Logo />
      <UserMenu user={user} />
    </header>
  )
}
