// @vitest-environment jsdom
import React from 'react';
import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {CompanyLogin} from '../../frontend/src/pages/Company.jsx';
import {useAuth} from '../../frontend/src/context/Auth.jsx';
import {api} from '../../frontend/src/services/api';
vi.mock('../../frontend/src/context/Auth.jsx',()=>({useAuth:vi.fn()}));
vi.mock('../../frontend/src/services/api',()=>({api:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function show(user){const setUser=vi.fn();useAuth.mockReturnValue({user,setUser});render(<MemoryRouter initialEntries={['/company/samsung/login']}><Routes><Route path="/company/:brand/login" element={<CompanyLogin/>}/></Routes></MemoryRouter>);return setUser;}
it('keeps sign-in fields visible when a customer is already signed in',()=>{
 show({name:'Current Customer',role:'customer'});expect(screen.getByLabelText('Email')).toBeTruthy();expect(screen.getByLabelText('Password')).toBeTruthy();expect(screen.getByRole('button',{name:'Sign in'})).toBeTruthy();expect(screen.getByText(/Enter your company credentials below/)).toBeTruthy();
});
it('does not sign out or replace the current account when company credentials fail',async()=>{
 const setUser=show({name:'boAt reviewer',role:'company_reviewer',company_brand:'boat'});api.mockRejectedValue(new Error('Company credentials do not match this portal.'));
 fireEvent.change(screen.getByLabelText('Email'),{target:{value:'staff@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'wrong-password'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Company credentials'));expect(setUser).not.toHaveBeenCalled();expect(screen.getByLabelText('Email')).toBeTruthy();
});
