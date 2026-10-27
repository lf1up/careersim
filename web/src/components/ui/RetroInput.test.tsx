import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { RetroInput, RetroSelect, RetroTextArea } from './RetroInput';
it('connects labels to fields even when no ID was supplied',()=>{
 render(<><RetroInput label="Title"/><RetroSelect label="Persona"><option>Alex</option></RetroSelect><RetroTextArea label="Objective"/></>);
 expect(screen.getByLabelText('Title')).toHaveAttribute('id');
 expect(screen.getByLabelText('Persona')).toHaveAttribute('id');
 expect(screen.getByLabelText('Objective')).toHaveAttribute('id');
});
