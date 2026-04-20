export interface Email {
  id: string;
  sender: string;
  senderEmail?: string;
  initials: string;
  time: string;
  subject: string;
  preview: string;
  unread: boolean;
  urgent: boolean;
  archived: boolean;
  deleted: boolean;
}

