import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { Button } from './Button';
import { Dialog, Sheet } from './Dialog';
import { TextField } from './Fields';
import { ComboBox, PickerItem } from './Pickers';

function EditSheet({ onSave, onCancel, saveDisabled = false }: { onSave: () => void; onCancel: () => void; saveDisabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>Edit time</Button>
      <Sheet
        isOpen={open}
        onOpenChange={setOpen}
        title="Edit time"
        description="Adjust the start and end of this entry."
        onCancel={onCancel}
        primaryAction={{
          label: 'Save time changes',
          isDisabled: saveDisabled,
          onAction: () => {
            onSave();
            setOpen(false);
          },
        }}
      >
        <TextField label="Start" defaultValue="09:00" />
        <TextField label="Comment" multiline />
        <ComboBox label="Activity" defaultItems={[{ id: 'dev', name: 'Development' }, { id: 'meeting', name: 'Meeting' }]}>
          {(item) => <PickerItem id={item.id}>{item.name}</PickerItem>}
        </ComboBox>
      </Sheet>
    </>
  );
}

describe('Dialog and Sheet', () => {
  it('moves focus inside, traps Tab and returns focus on Escape (cancel)', async () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    const { user } = renderWithProviders(<EditSheet onSave={onSave} onCancel={onCancel} />);
    const trigger = screen.getByRole('button', { name: 'Edit time' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Edit time' });
    expect(dialog).toHaveAccessibleDescription('Adjust the start and end of this entry.');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await expectNoA11yViolations();

    // Tab cycles within the sheet.
    for (let index = 0; index < 8; index++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('runs the default action on Return from a text field', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(<EditSheet onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Edit time' }));
    const start = await screen.findByRole('textbox', { name: 'Start' });
    await user.click(start);
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('leaves Return to controls that use it: buttons, text areas and open lists', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { user } = renderWithProviders(<EditSheet onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Edit time' }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('textbox', { name: 'Comment' }));
    await user.keyboard('First line{Enter}Second line');
    expect(within(dialog).getByRole('textbox', { name: 'Comment' })).toHaveValue('First line\nSecond line');

    const activity = within(dialog).getByRole('combobox', { name: 'Activity' });
    await user.click(activity);
    await user.keyboard('Meet');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(activity).toHaveValue('Meeting');
    expect(onSave).not.toHaveBeenCalled();

    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not run a disabled default action', async () => {
    const onSave = vi.fn();
    const { user } = renderWithProviders(<EditSheet onSave={onSave} onCancel={() => {}} saveDisabled />);
    await user.click(screen.getByRole('button', { name: 'Edit time' }));
    await user.click(await screen.findByRole('textbox', { name: 'Start' }));
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save time changes' })).toBeDisabled();
  });

  it('supports alert dialogs without a cancel button', async () => {
    const onAction = vi.fn();
    renderWithProviders(
      <Dialog
        isOpen
        onOpenChange={() => {}}
        role="alertdialog"
        title="Server stopped the timer"
        cancelLabel={null}
        primaryAction={{ label: 'Continue…', onAction }}
        secondaryActions={<Button>Keep stopped</Button>}
      />,
    );
    const dialog = await screen.findByRole('alertdialog', { name: 'Server stopped the timer' });
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
    await expectNoA11yViolations();
  });
});
