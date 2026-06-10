export interface TicketStub {
  key: string
  summary: string
  type?: string
  status?: string
  updated?: string
}

export interface TicketLink {
  relation: string
  key: string
  status?: string
  summary?: string
}

export interface TicketAttachment {
  filename: string
  mimeType?: string
  size?: number | null
  created?: string
}

export interface TicketEpic {
  key: string
  summary?: string
  description?: string
}

export interface TicketDetail {
  key: string
  summary: string
  type?: string
  status?: string
  priority?: string
  project: string
  created?: string
  updated?: string
  description?: string
  epic?: TicketEpic | null
  links: TicketLink[]
  attachments: TicketAttachment[]
  jiraUrl?: string
}
