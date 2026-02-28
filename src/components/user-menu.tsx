import { useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'

import { authClient } from '#/lib/auth-client'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

interface UserMenuProps {
  user: {
    name: string
    email: string
    image?: string | null
  }
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function UserMenu({ user }: UserMenuProps) {
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => navigate({ to: '/sign-in' }),
      },
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="rounded-full" size="icon" variant="ghost">
          <Avatar>
            {user.image && <AvatarImage alt={user.name} src={user.image} />}
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">{user.name}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
