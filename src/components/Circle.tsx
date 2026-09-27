'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heart, MessageCircle, Send, Trash2 } from 'lucide-react';
import './circle.css';
import Avatar from './Avatar';

type Participant = { userId: string; name: string; avatarKey?: string | null };
type Post = { id: string; userId: string; authorName: string; authorAvatarKey?: string | null; completedAt: string; elapsedSeconds: number; sessionName?: string | null; sharedSitId?: string | null; participants?: Participant[]; participantCount?: number; kudos: number; comments: number; viewerHasKudosed: boolean };
type Comment = { id: string; userId: string; name: string; avatarKey?: string | null; body: string; createdAt: string };
type Props = { signedIn: boolean; onSignIn: () => void; userId?: string };

const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
const relativeTime = (value: string) => { const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000)); return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`; };

export default function Circle({ signedIn, onSignIn, userId }: Props) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [commentError, setCommentError] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true); setError('');
    try { const response = await fetch('/api/feed', { credentials: 'include', cache: 'no-store' }); if (!response.ok) throw new Error('Could not load the circle'); setPosts((await response.json()).feed || []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the circle'); }
    finally { setLoading(false); }
  }, [signedIn]);
  useEffect(() => { void load(); }, [load]);

  const toggleKudos = async (post: Post) => { if (pending[post.id]) return; setPending((state) => ({ ...state, [post.id]: true })); try { const response = await fetch(`/api/sessions/${post.id}/kudos`, { method: 'POST', credentials: 'include' }); if (!response.ok) throw new Error('Could not update kudos'); const result = await response.json(); setPosts((state) => state.map((item) => item.id === post.id ? { ...item, viewerHasKudosed: result.kudosed, kudos: Math.max(0, item.kudos + (result.kudosed ? 1 : -1)) } : item)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update kudos'); } finally { setPending((state) => ({ ...state, [post.id]: false })); } };
  const showComments = async (id: string) => { setOpen((state) => ({ ...state, [id]: !state[id] })); if (comments[id]) return; try { const response = await fetch(`/api/sessions/${id}/comments`, { credentials: 'include', cache: 'no-store' }); if (!response.ok) throw new Error('Could not load comments'); const result = await response.json(); setComments((state) => ({ ...state, [id]: result.comments || [] })); } catch (cause) { setCommentError((state) => ({ ...state, [id]: cause instanceof Error ? cause.message : 'Could not load comments' })); } };
  const addComment = async (post: Post) => { const body = (text[post.id] || '').trim(); if (!body || body.length > 500 || pending[post.id]) return; setPending((state) => ({ ...state, [post.id]: true })); try { const response = await fetch(`/api/sessions/${post.id}/comments`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not add comment'); setComments((state) => ({ ...state, [post.id]: [...(state[post.id] || []), result.comment] })); setText((state) => ({ ...state, [post.id]: '' })); setPosts((state) => state.map((item) => item.id === post.id ? { ...item, comments: item.comments + 1 } : item)); } catch (cause) { setCommentError((state) => ({ ...state, [post.id]: cause instanceof Error ? cause.message : 'Could not add comment' })); } finally { setPending((state) => ({ ...state, [post.id]: false })); } };
  const deleteComment = async (post: Post, comment: Comment) => { if (pending[comment.id]) return; setPending((state) => ({ ...state, [comment.id]: true })); try { const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE', credentials: 'include' }); if (!response.ok) throw new Error('Could not delete comment'); setComments((state) => ({ ...state, [post.id]: (state[post.id] || []).filter((item) => item.id !== comment.id) })); setPosts((state) => state.map((item) => item.id === post.id ? { ...item, comments: Math.max(0, item.comments - 1) } : item)); } catch (cause) { setCommentError((state) => ({ ...state, [post.id]: cause instanceof Error ? cause.message : 'Could not delete comment' })); } finally { setPending((state) => ({ ...state, [comment.id]: false })); } };

  if (!signedIn) return <div className="empty-view"><div className="empty-mark">◌</div><h2>Find your circle</h2><p>Sign in to see quiet moments from the Still community.</p><button className="primary-button" onClick={onSignIn}>Sign in <span>→</span></button></div>;
  if (loading && !posts.length) return <div className="loading-state">Loading your circle…</div>;
  if (error && !posts.length) return <div className="feed-empty"><div className="empty-mark">!</div><h2>Couldn’t load the circle</h2><p>{error}</p><button className="text-button" onClick={() => void load()}>Try again</button></div>;
  return <div className="content-view circle-view">
    <div className="view-header"><div><div className="eyebrow">The circle</div><h1>People who sit.</h1></div><button className="round-button" onClick={() => void load()} aria-label="Refresh feed">↻</button></div>
    {error && <div className="circle-error" role="alert">{error} <button className="text-button" onClick={() => void load()}>Retry</button></div>}
    <div className="feed-tabs"><button className="selected">Everyone</button></div>
    {!posts.length ? <div className="feed-empty"><div className="empty-mark">◌</div><h2>Your circle is quiet</h2><p>Complete a session to start the conversation.</p></div> : posts.map((post) => <article className="post circle-post" key={post.id}>
      <div className="post-head"><Avatar name={post.authorName} avatarKey={post.authorAvatarKey} size="medium" /><div><strong>{post.sharedSitId ? 'A shared sit' : post.authorName}</strong><span>{relativeTime(post.completedAt)}</span></div></div>
      <div className="post-session"><span className="session-glyph">◌</span><div><strong>{post.sessionName || (post.sharedSitId ? 'Sat together' : 'Meditation')}</strong><span>{Math.round(post.elapsedSeconds / 60)} {Math.round(post.elapsedSeconds / 60) === 1 ? 'minute' : 'minutes'} {post.sharedSitId ? 'sat together' : 'of stillness'}</span></div></div>
      {post.sharedSitId && <div className="shared-participants" aria-label={`${post.participantCount || post.participants?.length || 0} participants`}><div className="participant-avatars">{(post.participants || []).map((participant) => <Avatar key={participant.userId} name={participant.name} avatarKey={participant.avatarKey} size="small" />)}</div><span>{(post.participants || []).map((participant) => participant.name).join(', ')}</span></div>}
      <div className="circle-actions"><button className={post.viewerHasKudosed ? 'is-active' : ''} disabled={pending[post.id]} aria-label={post.viewerHasKudosed ? 'Remove kudos' : 'Give kudos'} aria-pressed={post.viewerHasKudosed} onClick={() => void toggleKudos(post)}><Heart size={18} fill={post.viewerHasKudosed ? 'currentColor' : 'none'} /> <span>Kudos</span><b>{post.kudos}</b></button><button aria-label={`${post.comments} comments`} aria-expanded={!!open[post.id]} onClick={() => void showComments(post.id)}><MessageCircle size={18} /><span>Comment</span><b>{post.comments}</b></button></div>
      {open[post.id] && <div className="circle-comments"><div className="comment-list">{(comments[post.id] || []).map((comment) => <div className="circle-comment" key={comment.id}><Avatar name={comment.name} avatarKey={comment.avatarKey} size="small" /><div className="comment-content"><div className="comment-meta"><strong>{comment.name}</strong><span>{relativeTime(comment.createdAt)}</span>{userId === comment.userId && <button className="comment-delete" disabled={pending[comment.id]} aria-label="Delete comment" onClick={() => void deleteComment(post, comment)}><Trash2 size={12} /></button>}</div><p>{comment.body}</p></div></div>)}</div>{commentError[post.id] && <div className="form-error" role="alert">{commentError[post.id]}</div>}<div className="comment-form"><input aria-label="Comment" maxLength={500} value={text[post.id] || ''} onChange={(event) => setText((state) => ({ ...state, [post.id]: event.target.value }))} placeholder="Leave a comment…" /><button disabled={pending[post.id] || !(text[post.id] || '').trim()} onClick={() => void addComment(post)} aria-label="Post comment"><Send size={16} /> <span>Post</span></button></div></div>}
    </article>)}</div>;
}
