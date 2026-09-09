# Architecture & System Design

## 1. System Overview

The Legal Metrology Compliance Verification System automates the verification of mandatory package declarations (Net Qty, MRP, Manufacturer details, Expiry, Font Heights, etc.) according to Legal Metrology Packaged Commodities (LMPC) Rules.

```mermaid
flowchart TD
    subgraph Client ["Client (Frontend)"]
        UI_Capture["capture.html (Camera & Upload)"]
        UI_Dash["dashboard.html (Verdicts & Sessions)"]
    end

    subgraph Server ["FastAPI Backend"]
        Router["main.py (FastAPI Routes)"]
        
        subgraph Pipeline ["Processing Pipeline"]
            Quality["quality.py (Blur/Glare/Brightness)"]
            OCR["ocr.py (PaddleOCR Engine)"]
            Decl["declarations.py (Regex & Entity Extractor)"]
            Measure["measurement.py (Calibration & Sizing)"]
            Coverage["coverage.py (Evidence Coverage)"]
            Evidence["evidence.py (SHA-256 Hashing)"]
        end
        
        RulesEngine["rules_engine.py (Deterministic Evaluator)"]
        Storage["storage/db.py (In-Memory + JSON Store)"]
    end

    subgraph Config ["Rules Repository"]
        RulesJSON["rules/categories/packaged_food.json"]
    end

    UI_Capture -->|Multipart Upload| Router
    UI_Dash -->|REST Queries| Router
    Router --> Pipeline
    Pipeline --> Storage
    Router --> RulesEngine
    RulesEngine --> RulesJSON
    RulesEngine --> Storage
```

---

## 2. Core Service Responsibilities

1. **`quality.py`**:
   - Evaluates image suitability before OCR:
     - Laplacian variance for blur detection.
     - Pixel intensity histograms for under/over-exposure.
     - Specular reflection / glare thresholding.

2. **`ocr.py`**:
   - Pre-processes images (adaptive thresholding, deskewing).
   - Extracts bounding boxes and text tokens via PaddleOCR engine.

3. **`declarations.py`**:
   - Parses domain-specific entities using robust regex and rule patterns:
     - Net quantity & unit standardization (g, kg, ml, l).
     - MRP with currency and tax declaration (incl. of all taxes).
     - Month/year of manufacture/packing.
     - Best before / Expiry period.
     - Customer care contact (email, telephone).
     - Manufacturer & Packer identity with address/PIN code.

4. **`measurement.py`**:
   - Computes principal display panel (PDP) dimensions and font sizes.
   - Calculates measurement uncertainty intervals.

5. **`coverage.py`**:
   - Assesses multi-panel coverage to determine whether sufficient evidence exists across all sides.

6. **`rules_engine.py`**:
   - Loads versioned JSON rules.
   - Applies deterministic matching and threshold evaluations against extracted values and measurements.

7. **`evidence.py`**:
   - Computes cryptographic SHA-256 digests for all raw images and final verdicts to ensure auditability and tamper-evidence.

8. **`storage/db.py`**:
   - Thread-safe storage abstraction persisting session state and evaluation artifacts.
