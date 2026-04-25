import { useState, useRef, KeyboardEvent } from 'react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
}

/**
 * TagInput component for adding and removing tags/labels.
 * Supports keyboard navigation (Enter to add, Backspace to remove last tag).
 */
export function TagInput({ tags, onChange, placeholder = 'Add tag...', maxTags = 10 }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed) || tags.length >= maxTags) return;
    onChange([...tags, trimmed]);
    setInputValue('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      e.preventDefault();
      removeTag(tags.length - 1);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center bg-white/5 border border-white/10 rounded-lg p-2 focus-within:border-primary/50 transition-colors">
      {tags.map((tag, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full group/tag"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(index)}
            aria-label={`Remove tag: ${tag}`}
            className="text-primary/60 hover:text-primary transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary rounded-full"
          >
            <span className="material-symbols-outlined !text-[12px]" aria-hidden="true">close</span>
          </button>
        </span>
      ))}
      {tags.length < maxTags && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-sm text-foreground placeholder-text-muted/50 focus:outline-none"
          aria-label="Tag input"
        />
      )}
    </div>
  );
}
