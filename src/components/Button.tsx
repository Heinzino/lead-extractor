import Spinner from "./Spinner";

export default function Button({
  text,
  onClick,
  disabled = false,
  isLoading = false,
  width = 48,
  height = 16,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`px-6 py-4 w-${width} h-${height} border border-[#009bde] bg-[#009bde] text-white text-shadow-sm rounded-lg justify-center items-center font-semibold flex shadow-[0_1px_3px_#0000001a,0_-1px_#007aae,0_1px_0.75px_#ffffff1f,0_0_0_1px_#007aae] hover:cursor-pointer special-hover-shadow`}
    >
      {isLoading ? (
        <div className="mx-10 w-8 h-6">
          <Spinner color="text-white" />
        </div>
      ) : (
        text
      )}
    </button>
  );
}

