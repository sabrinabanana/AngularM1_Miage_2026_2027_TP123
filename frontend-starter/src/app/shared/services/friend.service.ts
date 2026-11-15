import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Activity } from '../models/activity.model';
import { FriendLists, Friendship } from '../models/friendship.model';
import { User } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class FriendService {
  private readonly http = inject(HttpClient);

  search(query: string) {
    return this.http.get<User[]>('/api/users/search', { params: { q: query } });
  }

  list() {
    return this.http.get<FriendLists>('/api/friends');
  }

  /** Fil d'activité : pistes récentes des amis et nouvelles amitiés. */
  activity(limit = 20) {
    return this.http.get<Activity[]>('/api/friends/activity', { params: { limit } });
  }

  request(userId: string) {
    return this.http.post<Friendship>('/api/friends/request', { userId });
  }

  accept(friendshipId: string) {
    return this.http.post<Friendship>(`/api/friends/accept/${friendshipId}`, {});
  }

  reject(friendshipId: string) {
    return this.http.post<void>(`/api/friends/reject/${friendshipId}`, {});
  }

  remove(friendshipId: string) {
    return this.http.delete<void>(`/api/friends/${friendshipId}`);
  }
}
