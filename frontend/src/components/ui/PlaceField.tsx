import { useEffect, useId, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { usePlaces } from '../../data/queries';
import type { PlaceResult } from '../../lib/contract';
import { fmtDistance } from '../../lib/format';

interface Props {
  id: string;
  label: string;
  /** The chosen junction's id, or '' for none. */
  value: string;
  /** The chosen junction's name, shown in the field when it was picked elsewhere (the map, the swap button). */
  valueName: string;
  onChange: (nodeId: string, name: string) => void;
  /** A junction not to offer: the other end of the route. */
  exclude?: string;
  placeholder?: string;
}

/**
 * A search field for one end of a route: type a junction or a road, and pick from what the region has
 * (GET /places). It follows the ARIA combobox pattern: arrow keys move through the list, Enter picks,
 * Escape closes it, and the list says plainly when nothing in the region matches.
 */
export function PlaceField({ id, label, value, valueName, onChange, exclude, placeholder }: Props) {
  const [text, setText] = useState(valueName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const listId = useId();
  const typing = useRef(false);

  // a pick made elsewhere shows up here; a change made by typing in this field does not wipe what is typed
  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    setText(valueName);
  }, [value, valueName]);

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 120);
    return () => clearTimeout(t);
  }, [text]);

  const places = usePlaces(open ? q : '');
  const options = (places.data?.places ?? []).filter((p) => p.node_id !== exclude);
  const showList = open && q.trim().length >= 2;

  const pick = (p: PlaceResult) => {
    onChange(p.node_id, p.name);
    setText(p.name);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(Math.max(0, options.length - 1), a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && showList && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="field place">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="place__box">
        <input
          id={id}
          className="input place__input"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (value) {
              typing.current = true;
              onChange('', '');
            }
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {text && (
          <button
            type="button"
            className="place__clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              setText('');
              if (value) onChange('', '');
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {showList && (
        <ul id={listId} role="listbox" className="place__list" aria-label={`${label}: places`}>
          {options.length ? (
            options.map((p, i) => (
              <li
                key={`${p.node_id}-${p.name}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`place__opt ${i === active ? 'is-active' : ''}`}
                // mousedown, not click: the input's blur would close the list before a click lands
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <MapPin size={14} aria-hidden="true" className="place__icon" />
                <span className="place__name">{p.name}</span>
                <span className="place__meta">
                  {p.kind === 'place' ? [p.context, `${fmtDistance(p.distance_m)} from the highway`].filter(Boolean).join(' · ') : p.roads.join(' · ')}
                </span>
              </li>
            ))
          ) : (
            <li className="place__none" role="option" aria-selected={false} aria-disabled="true">
              {places.isFetching ? 'Searching…' : `Nothing called “${q.trim()}” in this region`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
