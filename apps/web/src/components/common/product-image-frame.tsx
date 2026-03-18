import Image from "next/image";
import { cn } from "@/lib/utils";

type ProductImageFrameProps = {
  src: string;
  alt: string;
  sizes: string;
  quality?: number;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
};

export function ProductImageFrame({
  src,
  alt,
  sizes,
  quality = 90,
  className,
  imageClassName,
  priority = false,
}: ProductImageFrameProps) {
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100", className)}>
      <Image
        src={src}
        alt=""
        fill
        aria-hidden
        sizes={sizes}
        quality={70}
        className="scale-110 object-cover blur-2xl saturate-75 opacity-45"
      />
      <div className="absolute inset-0 bg-white/30" />
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        quality={quality}
        className={cn("object-contain p-4", imageClassName)}
      />
    </div>
  );
}
