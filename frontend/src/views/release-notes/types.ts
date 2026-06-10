export interface VersionStub {
  id: number | string
  name: string
  project?: string
  released?: boolean
  releaseDate?: string
}

export interface RnIssue {
  key: string
  type?: string
  priority?: string
  summary?: string
  status?: string
}

export interface VersionDetail {
  id: number | string
  name: string
  project: string
  description?: string
  startDate?: string
  releaseDate?: string
  released?: boolean
  driver?: string | null
  jiraUrl?: string
  issues: RnIssue[]
  issueCount: number
}
