import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AuthModal from '@/components/AuthModal'
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
it('offers Google for login and signup and preserves invitation context',async()=>{
 const assign=vi.fn(); vi.stubGlobal('window',{document,location:{pathname:'/',search:'?sit=invite',assign}})
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({url:'https://accounts.google.com/auth'})});vi.stubGlobal('fetch',fetch)
 render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} />)
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}))
 await waitFor(()=>expect(assign).toHaveBeenCalledWith('https://accounts.google.com/auth'))
 expect(JSON.parse(fetch.mock.calls[0][1].body).returnTo).toBe('/?sit=invite')
 fireEvent.click(screen.getByRole('button',{name:'New to Still? Create an account'}));expect(screen.getByRole('button',{name:'Continue with Google'})).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Already have an account? Sign in'})); fireEvent.click(screen.getByRole('button',{name:'Forgot password?'}));expect(screen.queryByRole('button',{name:'Continue with Google'})).toBeNull()
})
it('shows configuration/provider failures and permits retry',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({error:'Google is unavailable'})}).mockResolvedValueOnce({ok:false,json:async()=>({})}).mockResolvedValueOnce({ok:true,json:async()=>({})}).mockRejectedValueOnce('offline'))
 render(<AuthModal onClose={vi.fn()} onSuccess={vi.fn()} initialError="Google sign-in could not finish." />)
 expect(screen.getByRole('alert')).toHaveTextContent('could not finish')
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}));await screen.findByText('Google is unavailable')
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}));await screen.findByText('Unable to start Google sign-in.')
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Continue with Google'})).not.toBeDisabled())
 fireEvent.click(screen.getByRole('button',{name:'Continue with Google'}));await screen.findByText('Unable to reach Google sign-in. Try again.')
})
