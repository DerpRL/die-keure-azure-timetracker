import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  NumberField as AriaNumberField,
  SearchField as AriaSearchField,
  Text,
  TextArea,
  TextField as AriaTextField,
  type NumberFieldProps as AriaNumberFieldProps,
  type SearchFieldProps as AriaSearchFieldProps,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from './icons';
import styles from './Fields.module.css';

interface FieldChromeProps {
  /** Visible label. Use `hideLabel` only where the context labels the field visually. */
  label: string;
  hideLabel?: boolean;
  description?: ReactNode;
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** Field width; `full` stretches, `auto` sizes to the container's flow. */
  width?: 'auto' | 'full' | 'narrow';
  className?: string;
}

export function FieldLabel({ children, hidden }: { children: ReactNode; hidden?: boolean }) {
  return <Label className={hidden ? 'visually-hidden' : styles.label}>{children}</Label>;
}

export function FieldDescription({ children }: { children: ReactNode }) {
  return (
    <Text slot="description" className={styles.description}>
      {children}
    </Text>
  );
}

export function FieldErrorMessage({ children }: { children?: FieldChromeProps['errorMessage'] }) {
  return <FieldError className={styles.error}>{children}</FieldError>;
}

export interface TextFieldProps extends FieldChromeProps, Omit<AriaTextFieldProps, 'className' | 'style' | 'children'> {
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}

export function TextField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  placeholder,
  multiline = false,
  rows = 4,
  className,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField {...props} className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      {multiline ? (
        <TextArea placeholder={placeholder} rows={rows} className={cx(styles.input, styles.textarea)} />
      ) : (
        <Input placeholder={placeholder} className={styles.input} />
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTextField>
  );
}

export interface NumberFieldProps extends FieldChromeProps, Omit<AriaNumberFieldProps, 'className' | 'style' | 'children'> {
  /** Unit shown after the value for sighted users; include it in `formatOptions` for SR output. */
  unit?: string;
}

export function NumberField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'narrow',
  unit,
  className,
  ...props
}: NumberFieldProps) {
  return (
    <AriaNumberField {...props} className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <Group className={styles.group}>
        <Input className={cx(styles.input, styles.groupInput)} />
        {unit ? (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        ) : null}
        <div className={styles.stepper}>
          <AriaButton slot="increment" className={styles.stepButton}>
            <ChevronUpIcon />
          </AriaButton>
          <AriaButton slot="decrement" className={styles.stepButton}>
            <ChevronDownIcon />
          </AriaButton>
        </div>
      </Group>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaNumberField>
  );
}

export interface SearchFieldProps extends FieldChromeProps, Omit<AriaSearchFieldProps, 'className' | 'style' | 'children'> {
  placeholder?: string;
}

/** Search input with a clear button; Escape clears, as in native search fields. */
export function SearchField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  placeholder,
  className,
  ...props
}: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={cx(styles.field, styles.search, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <div className={styles.searchBox}>
        <SearchIcon className={styles.searchIcon} />
        <Input placeholder={placeholder} className={cx(styles.input, styles.searchInput)} />
        <AriaButton className={styles.clearButton} aria-label="Clear search">
          <CloseIcon />
        </AriaButton>
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaSearchField>
  );
}
