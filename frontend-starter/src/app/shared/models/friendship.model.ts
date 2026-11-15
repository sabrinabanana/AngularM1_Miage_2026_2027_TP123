import { User } from './user.model';

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted' | 'rejected';
  user: User;
  createdAt: string;
  updatedAt: string;
}

export interface FriendLists {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
}
