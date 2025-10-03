from fastapi import FastAPI
from pydantic import BaseModel
import spacy
import json
from spacy.matcher import Matcher
from spacy.pipeline import EntityRuler

nlp = spacy.load("es_core_news_sm")

# -------------------------
# Cargar datasets
# -------------------------
with open("medicamentos.json", "r", encoding="utf-8") as f:
    data = json.load(f)

with open("enfermedades.json", "r", encoding="utf-8") as f:
    data2 = json.load(f)

# Normalizar medicamentos
lista_meds = sorted(set([item["nombre"].strip().lower() for item in data if "nombre" in item]))

# Normalizar enfermedades (pueden venir como lista o string)
lista_enf = sorted(set([
    val.strip().lower()
    for item2 in data2 if "indicaciones" in item2
    for val in (item2["indicaciones"] if isinstance(item2["indicaciones"], list) else [item2["indicaciones"]])
]))

print("Ejemplos de enfermedades:", lista_enf[:10])
print("Ejemplos de medicamentos:", lista_meds[:10])

# -------------------------
# EntityRuler para enfermedades y medicamentos
# -------------------------
ruler = nlp.add_pipe("entity_ruler", before="ner")

patterns = [{"label": "MEDICAMENTO", "pattern": med} for med in lista_meds]
patterns += [{"label": "ENFERMEDAD", "pattern": enf} for enf in lista_enf]

ruler.add_patterns(patterns)

# -------------------------
# Matcher para medicamento + dosis
# -------------------------
matcher = Matcher(nlp.vocab)

patron_dosis = [
    {"IS_ALPHA": True},                   # nombre candidato
    {"LOWER": "de", "OP": "?"},           
    {"LIKE_NUM": True},                   
    {"LOWER": {"IN": ["mg", "ml", "mcg", "g"]}}
]
matcher.add("MEDICAMENTO_DOSIS", [patron_dosis])

# -------------------------
# FastAPI
# -------------------------
app = FastAPI()

class TextoEntrada(BaseModel):
    texto: str

@app.post("/procesar")
def procesar(data: TextoEntrada):
    print("Texto recibido:", data.texto)
    doc = nlp(data.texto)
    entidades = []

    # Detectar entidades con EntityRuler
    for ent in doc.ents:
        if ent.label_ in ["MEDICAMENTO", "ENFERMEDAD"]:
            entidades.append({
                "texto": ent.text,
                "tipo": ent.label_
            })

    # Detectar medicamento + dosis
    for match_id, start, end in matcher(doc):
        span = doc[start:end]
        if span[0].text.lower() in lista_meds:  # validar que el primer token sea medicamento real
            entidades.append({
                "texto": span.text,
                "tipo": "MEDICAMENTO_DOSIS"
            })

    print("Entidades detectadas:", entidades)
    return {"entidades": entidades}
