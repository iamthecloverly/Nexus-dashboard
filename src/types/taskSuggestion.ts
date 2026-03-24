export interface TaskSuggestion {
  id: string;
  emailId: string;
  title: string;
  priority: 'Normal' | 'Priority' | 'Critical';
  group: 'now' | 'next';
  reason: string;
  accepted: boolean;
}
