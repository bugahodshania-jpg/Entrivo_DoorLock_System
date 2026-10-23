import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function SecurityQuestionSelect({ value, options, labelId, disabled, onChange }) {
  const menuId = useId();
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const enabledIndices = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!isOpen) return undefined;
    function closeOnOutsideClick(event) {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.getElementById(`${menuId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, isOpen, menuId]);

  function openMenu() {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndices[0]);
    setIsOpen(true);
  }

  function selectOption(index) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) openMenu();
      else {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const position = enabledIndices.indexOf(activeIndex);
        setActiveIndex(enabledIndices[(position + direction + enabledIndices.length) % enabledIndices.length]);
      }
    } else if ((event.key === 'Home' || event.key === 'End') && isOpen) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? enabledIndices[0] : enabledIndices.at(-1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isOpen) selectOption(activeIndex);
      else openMenu();
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    } else if (event.key === 'Tab') setIsOpen(false);
  }

  return (
    <div
      className="user-security-question-select"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="user-security-question-trigger"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={isOpen && !disabled}
        aria-controls={menuId}
        aria-activedescendant={isOpen && !disabled ? `${menuId}-${activeIndex}` : undefined}
        disabled={disabled}
        onKeyDown={handleKeyDown}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
      >
        <span title={selected?.label}>{selected?.label || 'Select a question'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {isOpen && !disabled ? (
        <div id={menuId} className="user-security-question-menu" role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              className={`user-security-question-option${activeIndex === index ? ' is-focused' : ''}`}
              aria-selected={option.value === value}
              disabled={option.disabled}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
              onClick={() => selectOption(index)}
            >
              <Check size={13} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
