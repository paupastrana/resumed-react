from fastapi import FastAPI
from pydantic import BaseModel
import spacy
import json
from spacy.matcher import PhraseMatcher, Matcher 
from spacy.tokens import Doc
from typing import List, Dict, Any
import re

# ----------------------------------------------------
# 1. CONFIGURACIÓN Y CARGA MEJORADA DE DATOS
# ----------------------------------------------------

try:
    nlp = spacy.load("es_core_news_sm") 
except OSError:
    print("ADVERTENCIA: Modelo de spaCy no encontrado. Usando modelo en blanco.")
    nlp = spacy.blank("es") 
    
def cargar_medicamentos_mejorado(archivo: str) -> List[str]:
    """Carga medicamentos considerando nombres y formas farmacéuticas"""
    try:
        with open(archivo, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        terminos_medicamentos = []
        for med in data:
            # Agregar nombre principal
            if "nombre" in med:
                terminos_medicamentos.append(med["nombre"].lower())
            
            # Agregar nombres comerciales
            if "nombres_comerciales" in med:
                for nombre_comercial in med["nombres_comerciales"]:
                    terminos_medicamentos.append(nombre_comercial.lower())
            
            # Agregar combinaciones con formas farmacéuticas
            if "formas" in med and "nombre" in med:
                for forma in med["formas"]:
                    terminos_medicamentos.append(f"{med['nombre']} {forma}".lower())
        
        return sorted(set(terminos_medicamentos))
    
    except FileNotFoundError:
        print(f"ERROR: No se encontró {archivo}. Usando datos de prueba.")
        return ["metformina", "gliclazida", "lisinopril", "furosemida", "buscapina compositum"]

def cargar_enfermedades_mejorado(archivo: str) -> List[str]:
    """Carga enfermedades considerando sinónimos y abreviaturas"""
    try:
        with open(archivo, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        terminos_enfermedades = []
        for enfermedad in data:
            # Agregar nombre principal
            if "nombre" in enfermedad:
                terminos_enfermedades.append(enfermedad["nombre"].lower())
            
            # Agregar sinónimos y abreviaturas
            if "sinonimos" in enfermedad:
                for sinonimo in enfermedad["sinonimos"]:
                    terminos_enfermedades.append(sinonimo.lower())
        
        return sorted(set(terminos_enfermedades))
    
    except FileNotFoundError:
        print(f"ERROR: No se encontró {archivo}. Usando datos de prueba.")
        return ["hipertensión", "diabetes", "insuficiencia cardíaca", "colelitiasis"]

# Cargar datos mejorados
lista_meds_str = cargar_medicamentos_mejorado("medi.json")
lista_enf_str = cargar_enfermedades_mejorado("enfe.json")

print(f"Medicamentos cargados: {len(lista_meds_str)}")
print(f"Enfermedades cargadas: {len(lista_enf_str)}")
print("Ejemplos de medicamentos:", lista_meds_str[:5])
print("Ejemplos de enfermedades:", lista_enf_str[:5])

# ----------------------------------------------------
# 2. CONFIGURACIÓN DE MATCHERS
# ----------------------------------------------------

phrase_matcher = PhraseMatcher(nlp.vocab, attr="LOWER")

def crear_patrones_doc(term_list: List[str]) -> List[Doc]:
    return list(nlp.pipe(term_list)) 

med_patterns = crear_patrones_doc(lista_meds_str)
enf_patterns = crear_patrones_doc(lista_enf_str)

phrase_matcher.add("MEDICAMENTO", med_patterns)
phrase_matcher.add("ENFERMEDAD", enf_patterns)

# Matcher para dosis (mantener igual que antes)
dosis_matcher = Matcher(nlp.vocab)
patron_dosis = [
    {"LIKE_NUM": True},                   
    {"LOWER": {"IN": ["mg", "ml", "mcg", "g", "ui", "u", "iu", "cc", "mmol", "meq"]}}
]
patron_frecuencia = [
    {"LOWER": "c"}, 
    {"IS_PUNCT": True, "OP": "?"},
    {"LIKE_NUM": True},
    {"LOWER": {"IN": ["h", "horas", "día", "días"]}}
]
dosis_matcher.add("DOSIS", [patron_dosis])
dosis_matcher.add("FRECUENCIA", [patron_frecuencia])

# ----------------------------------------------------
# 3. FUNCIONES DE PROCESAMIENTO
# ----------------------------------------------------

def limpiar_texto(texto: str) -> str:
    """Limpia el texto para mejor procesamiento"""
    texto = texto.lower()
    
    # Reemplazar abreviaturas médicas comunes
    reemplazos = {
        "c/12h": "cada 12 horas",
        "c/24h": "cada 24 horas", 
        "c/8h": "cada 8 horas",
        "sos": "cuando sea necesario",
        "tx:": "tratamiento:",
        "mc:": "motivo de consulta:",
        "hta": "hipertensión arterial",
        "dm2": "diabetes mellitus tipo 2",
        "icc": "insuficiencia cardíaca congestiva"
    }
    
    for abrev, reemplazo in reemplazos.items():
        texto = texto.replace(abrev, reemplazo)
    
    # Separar números de unidades
    texto = re.sub(r'(\d)([a-z])', r'\1 \2', texto)
    
    return texto

def encontrar_dosis_asociada(doc: Doc, posicion_med: int, ventana: int = 8) -> Dict[str, str]:
    """Encuentra dosis y frecuencia asociadas a un medicamento"""
    dosis_matches = dosis_matcher(doc)
    
    dosis_encontrada = None
    frecuencia_encontrada = None
    
    for match_id, start, end in dosis_matches:
        distancia = start - posicion_med
        
        if 0 <= distancia <= ventana:
            texto_match = doc[start:end].text
            tipo_match = nlp.vocab.strings[match_id]
            
            if tipo_match == "DOSIS" and not dosis_encontrada:
                dosis_encontrada = texto_match
            elif tipo_match == "FRECUENCIA" and not frecuencia_encontrada:
                frecuencia_encontrada = texto_match
    
    return {"dosis": dosis_encontrada, "frecuencia": frecuencia_encontrada}

# ----------------------------------------------------
# 4. API ENDPOINT
# ----------------------------------------------------

app = FastAPI()

class TextoEntrada(BaseModel):
    texto: str

@app.post("/procesar")
def procesar(data: TextoEntrada) -> Dict[str, List[Dict[str, str]]]:
    """Endpoint principal de procesamiento"""
    
    # Preprocesar texto
    texto_limpio = limpiar_texto(data.texto)
    doc = nlp(texto_limpio)
    
    # Buscar coincidencias
    matches = phrase_matcher(doc)
    
    resultados = {}
    
    # Procesar medicamentos
    for match_id, start, end in matches:
        label = nlp.vocab.strings[match_id]
        span = doc[start:end]
        
        if label == "MEDICAMENTO":
            # Buscar dosis asociada
            info_dosis = encontrar_dosis_asociada(doc, end)
            
            if info_dosis["dosis"] or info_dosis["frecuencia"]:
                # Construir texto completo del medicamento con dosis
                texto_completo = span.text
                if info_dosis["dosis"]:
                    texto_completo += f" {info_dosis['dosis']}"
                if info_dosis["frecuencia"]:
                    texto_completo += f" {info_dosis['frecuencia']}"
                
                resultados[texto_completo] = "MEDICAMENTO_DOSIS"
            else:
                resultados[span.text] = "MEDICAMENTO"
                
        elif label == "ENFERMEDAD":
            resultados[span.text] = "ENFERMEDAD"
    
    # Convertir a lista final
    entidades_finales = [{"texto": texto, "tipo": tipo} for texto, tipo in resultados.items()]
    
    return {"entidades": entidades_finales}

@app.get("/terminos-cargados")
def terminos_cargados():
    """Endpoint para verificar qué términos están cargados"""
    return {
        "medicamentos": lista_meds_str,
        "enfermedades": lista_enf_str
    }

if __name__ == "__main__":
    print("=== SISTEMA DE EXTRACCIÓN MÉDICA MEJORADO ===")
    print("API lista para ejecutarse con: uvicorn main:app --reload")
    
    # Prueba
    test_text = "Consulta Médica - Paciente: Rodríguez, Carlos (62 años). MC: Disnea de esfuerzo (NYHA II) y dolor abdominal recurrente en cuadrante superior derecho. APP: HTA (15 años), DM2 (10 años, HbA1c 8.5%), Colelitiasis. Objetivo: TA 145/92, SatO2 93%, Edema leve bilateral en tobillos, Dolor a la palpación en hipocondrio derecho. Evaluación: 1. ICC descompensada. 2. DM2 mal controlada. 3. HAS no controlada. 4. Dolor abdominal por descartar origen biliar. Plan: Solicitar ECG, US Abdominal, Perfil Hepático, HbA1c. Tx: Metformina 1000mg c/12h; Gliclazida 30mg c/24h; Lisinopril 10mg c/24h; Furosemida 40mg c/24h; Buscapina Compositum (SOS dolor). Indicaciones: Dieta baja en sodio, Revaloración en 7 días."
    
    test_data = TextoEntrada(texto=test_text)
    
    print("\n--- PRUEBA DE EXTRACCIÓN ---")
    resultados = procesar(test_data)
    print(json.dumps(resultados, indent=2, ensure_ascii=False))