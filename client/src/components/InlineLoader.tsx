import React from "react";
import "../css/InlineLoader.css";

interface InlineLoaderProps {
    size?: number;
    color?: string;
}

const InlineLoader: React.FC<InlineLoaderProps> = ({ 
    size = 16,
    color = "rgba(0,0,0,0.6)",
}) => {
    return (
        <span
            className="inline-loader"
            style={{ 
                width: size,
                height: size,
                borderColor: `${color}33`,
                borderTopColor: color,
            }}
            aria-label="Loading"
            role="status"
        />
    );
};

export default InlineLoader;