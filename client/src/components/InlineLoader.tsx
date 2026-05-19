import React from "react";
import "../css/InlineLoader.css";

interface InlineLoaderProps {
    size?: number;
}

const InlineLoader: React.FC<InlineLoaderProps> = ({ size = 16 }) => {
    return (
        <span
            className="inline-loader"
            style={{ width: size, height: size }}
            aria-label="Loading"
            role="status"
        />
    );
};

export default InlineLoader;