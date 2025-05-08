import Spinner from "./Spinner";

export default function Button({
  text,
  onClick,
  disabled = false,
  isLoading = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  variant?: 'primary' | 'secondary' | 'tertiary';
  size?: 'small' | 'medium' | 'large';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="px-6 py-4 w-24 h-16 border border-[#009bde] bg-[#009bde] text-white text-shadow-sm rounded-lg justify-center items-center font-semibold flex shadow-[0_1px_3px_#0000001a,0_-1px_#007aae,0_1px_0.75px_#ffffff1f,0_0_0_1px_#007aae] hover:cursor-pointer special-hover-shadow"
    >
      {isLoading ? <div className="w-24 h-16 flex items-center justify-center p-2"><Spinner/></div> : text}
    </button>
  );
}

