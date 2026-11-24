import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LevelBadge, Notice, Segmented, SeverityBadge } from './primitives';
import { LevelBar } from '../charts/charts';

describe('badges', () => {
  it('names the level in words, never colour alone', () => {
    render(<LevelBadge level="severe" />);
    expect(screen.getByText('Severe')).toBeInTheDocument();
  });

  it('shows "No data" for an empty segment', () => {
    render(<LevelBadge level="no_data" />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('names incident severity', () => {
    render(<SeverityBadge severity="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});

describe('Notice', () => {
  it('uses an alert role for errors so screen readers announce it', () => {
    render(<Notice tone="bad" title="Cannot load traffic data" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot load traffic data');
  });
});

describe('Segmented', () => {
  it('is a radio group that reports the picked value', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Horizon"
        value={10}
        onChange={onChange}
        options={[
          { value: 5, label: '5 min' },
          { value: 10, label: '10 min' },
        ]}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Horizon' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '10 min' })).toBeChecked();
    await userEvent.click(screen.getByText('5 min'));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});

describe('LevelBar', () => {
  it('describes every part in its accessible name and skips empty levels', () => {
    render(<LevelBar title="Road by level" km={{ free: 10, moderate: 0, heavy: 2.5, severe: 0, no_data: 0 }} />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleName('Road by level: Free flow 10.0 km, Heavy 2.5 km');
  });
});
