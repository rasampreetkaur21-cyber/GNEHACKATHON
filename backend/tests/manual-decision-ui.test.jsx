// @vitest-environment jsdom
import React from 'react';
import {it,expect,afterEach,vi} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import ManualDecision from '../../frontend/src/components/ManualDecision.jsx';
afterEach(cleanup);
it('shows approval clearly but only submits the selected decision with a reason',()=>{
 let submitted;const save=vi.fn(e=>{e.preventDefault();submitted=Object.fromEntries(new FormData(e.currentTarget));});
 render(<ManualDecision onSubmit={save}/>);
 expect(screen.getByRole('radio',{name:/Approve claim/})).toBeTruthy();const button=screen.getByRole('button',{name:'Save manual decision'});expect(button.disabled).toBe(true);
 fireEvent.click(screen.getByRole('radio',{name:/Approve claim/}));expect(save).not.toHaveBeenCalled();expect(button.disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Reason shown to customer'),{target:{value:'Reviewer checked the original purchase proof and device.'}});fireEvent.click(button);
 expect(save).toHaveBeenCalledOnce();expect(submitted).toMatchObject({status:'APPROVED',reason:'Reviewer checked the original purchase proof and device.'});
});
it('shows a final decision without editable controls for closed claims',()=>{
 render(<ManualDecision closed status="REJECTED"/>);expect(screen.getByRole('heading',{name:'Final human decision: Rejected'})).toBeTruthy();expect(screen.queryByRole('radio')).toBeNull();
});
