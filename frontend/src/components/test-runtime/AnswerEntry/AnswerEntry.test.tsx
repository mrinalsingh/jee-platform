import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswerEntry } from './index';

const baseProps = {
  onClear: () => {},
  disabled: false,
};

describe('MCQ-SC', () => {
  it('selects an option on click', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="MCQ-SC"
        spec={{ type: 'MCQ-SC', option_count: 4 }}
        value={{ type: 'MCQ-SC', selected_option: null }}
        options={['$1$', '$2$', '$3$', '$4$']}
        onChange={onChange}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByLabelText('Option B'));
    expect(onChange).toHaveBeenCalledWith({
      type: 'MCQ-SC',
      selected_option: 1,
    });
  });
});

describe('MCQ-MC', () => {
  it('toggles selection', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="MCQ-MC"
        spec={{ type: 'MCQ-MC', option_count: 4 }}
        value={{ type: 'MCQ-MC', selected_options: [0] }}
        options={['$1$', '$2$', '$3$', '$4$']}
        onChange={onChange}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByLabelText('Option C'));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'MCQ-MC',
      selected_options: [0, 2],
    });
  });
});

describe('NUM-INT', () => {
  it('accepts digits via virtual keypad', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="NUM-INT"
        spec={{ type: 'NUM-INT', precision: 0, min: -999, max: 999 }}
        value={{ type: 'NUM-INT', value: null }}
        onChange={onChange}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByLabelText('Keypad 7'));
    expect(onChange).toHaveBeenCalledWith({ type: 'NUM-INT', value: '7' });
  });
});

describe('NUM-DEC', () => {
  it('refuses a digit past precision', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="NUM-DEC"
        spec={{ type: 'NUM-DEC', precision: 2 }}
        value={{ type: 'NUM-DEC', value: '2.83' }}
        onChange={onChange}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByLabelText('Keypad 7'));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('accepts a digit within precision', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="NUM-DEC"
        spec={{ type: 'NUM-DEC', precision: 2 }}
        value={{ type: 'NUM-DEC', value: '2.8' }}
        onChange={onChange}
        {...baseProps}
      />,
    );
    fireEvent.click(screen.getByLabelText('Keypad 3'));
    expect(onChange).toHaveBeenCalledWith({
      type: 'NUM-DEC',
      value: '2.83',
    });
  });
});

describe('MAT-COL', () => {
  it('picks a list-II option for a row', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="MAT-COL"
        spec={{ type: 'MAT-COL', list_i_count: 4, list_ii_count: 5 }}
        value={{ type: 'MAT-COL', pairs: {} }}
        list_i={['Statement A', 'Statement B', 'Statement C', 'Statement D']}
        list_ii={['One', 'Two', 'Three', 'Four', 'Five']}
        onChange={onChange}
        {...baseProps}
      />,
    );
    const select = screen.getByLabelText('List II selection for row P');
    fireEvent.change(select, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith({
      type: 'MAT-COL',
      pairs: { 0: 2 },
    });
  });

  it('renders the configured number of rows', () => {
    render(
      <AnswerEntry
        answerType="MAT-COL"
        spec={{ type: 'MAT-COL', list_i_count: 3, list_ii_count: 4 }}
        value={{ type: 'MAT-COL', pairs: {} }}
        list_i={['A', 'B', 'C']}
        list_ii={['One', 'Two', 'Three', 'Four']}
        onChange={() => {}}
        {...baseProps}
      />,
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });
});

describe('unknown answer type', () => {
  it('shows a hard error block', () => {
    render(
      <AnswerEntry
        // @ts-expect-error — deliberately unknown
        answerType="FUTURE-TYPE"
        spec={{ type: 'MCQ-SC', option_count: 4 }}
        value={null}
        onChange={() => {}}
        {...baseProps}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported');
  });
});

describe('disabled state', () => {
  it('blocks MCQ-SC clicks', () => {
    const onChange = vi.fn();
    render(
      <AnswerEntry
        answerType="MCQ-SC"
        spec={{ type: 'MCQ-SC', option_count: 4 }}
        value={{ type: 'MCQ-SC', selected_option: null }}
        options={['$1$', '$2$', '$3$', '$4$']}
        onChange={onChange}
        onClear={() => {}}
        disabled
      />,
    );
    const fieldset = screen.getByRole('group');
    const radioA = within(fieldset).getByLabelText('Option A');
    expect(radioA).toBeDisabled();
  });
});
