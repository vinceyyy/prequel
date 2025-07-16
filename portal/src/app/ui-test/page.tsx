'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Download, Mail, Settings, Star, Users } from 'lucide-react'

export default function UITestPage() {
  const [isLoading, setIsLoading] = useState(false)

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            shadcn/ui Components Test
          </h1>
          <p className="text-xl text-muted-foreground">
            A demonstration of the latest shadcn/ui components in your
            application
          </p>
        </div>

        {/* Button Variants */}
        <Card>
          <CardHeader>
            <CardTitle>Button Variants</CardTitle>
            <CardDescription>
              Different button styles and states available in shadcn/ui
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
            </div>

            <div className="flex flex-wrap gap-4">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon">
                <Settings className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-4">
              <Button disabled>Disabled</Button>
              <Button
                onClick={() => {
                  setIsLoading(true)
                  setTimeout(() => setIsLoading(false), 2000)
                }}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
                    Loading...
                  </>
                ) : (
                  'Click to Load'
                )}
              </Button>
            </div>

            <div className="flex flex-wrap gap-4">
              <Button>
                <Mail className="mr-2 h-4 w-4" />
                With Icon
              </Button>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Badge Variants */}
        <Card>
          <CardHeader>
            <CardTitle>Badge Variants</CardTitle>
            <CardDescription>
              Status badges perfect for showing operation states
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Interview Status Examples */}
        <Card>
          <CardHeader>
            <CardTitle>Interview Status Examples</CardTitle>
            <CardDescription>
              How the badges could be used for different interview states
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge variant="secondary">Scheduled</Badge>
                <span className="text-sm text-muted-foreground">
                  Interview is scheduled for later
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="outline">Initializing</Badge>
                <span className="text-sm text-muted-foreground">
                  AWS infrastructure being created
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="outline">Configuring</Badge>
                <span className="text-sm text-muted-foreground">
                  VS Code environment setting up
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="default">Active</Badge>
                <span className="text-sm text-muted-foreground">
                  Ready for candidate access
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="outline">Destroying</Badge>
                <span className="text-sm text-muted-foreground">
                  Resources being cleaned up
                </span>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="destructive">Error</Badge>
                <span className="text-sm text-muted-foreground">
                  Something went wrong
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card Layouts */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Users className="h-5 w-5" />
                <CardTitle>Interviews</CardTitle>
              </div>
              <CardDescription>Manage your coding interviews</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">12</div>
              <p className="text-xs text-muted-foreground">+2 from last week</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Calendar className="h-5 w-5" />
                <CardTitle>Scheduled</CardTitle>
              </div>
              <CardDescription>Upcoming interviews</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">5</div>
              <p className="text-xs text-muted-foreground">
                Next: Tomorrow 2PM
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Star className="h-5 w-5" />
                <CardTitle>Success Rate</CardTitle>
              </div>
              <CardDescription>Completed successfully</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">94%</div>
              <p className="text-xs text-muted-foreground">
                +5% from last month
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Complex Card Example */}
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Create Interview</CardTitle>
            <CardDescription>
              Set up a new coding interview session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Candidate Name</label>
              <input
                className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Enter candidate name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Challenge</label>
              <select className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring">
                <option>JavaScript</option>
                <option>Python</option>
                <option>React</option>
                <option>SQL</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="schedule"
                className="rounded border-input"
              />
              <label htmlFor="schedule" className="text-sm">
                Schedule for later
              </label>
            </div>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button className="flex-1">Create Interview</Button>
            <Button variant="outline" className="flex-1">
              Cancel
            </Button>
          </CardFooter>
        </Card>

        {/* Color Showcase */}
        <Card>
          <CardHeader>
            <CardTitle>Color System</CardTitle>
            <CardDescription>
              The design system automatically adapts to light and dark mode
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <div className="h-16 bg-primary rounded-md flex items-center justify-center">
                  <span className="text-primary-foreground text-sm font-medium">
                    Primary
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-secondary rounded-md flex items-center justify-center">
                  <span className="text-secondary-foreground text-sm font-medium">
                    Secondary
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-muted rounded-md flex items-center justify-center">
                  <span className="text-muted-foreground text-sm font-medium">
                    Muted
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-accent rounded-md flex items-center justify-center">
                  <span className="text-accent-foreground text-sm font-medium">
                    Accent
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Back to Home */}
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/">Back to Portal</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
